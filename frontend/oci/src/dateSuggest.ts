/** Quick-Add `@date` suggestion dropdown and day-token resolution (issues
 * #211, #212): pure text/caret logic modelled on `tagSuggest.ts` /
 * `listSuggest.ts` / `prioritySuggest.ts` (with an extra `now` / `timeZone`
 * pair threaded through, since this channel resolves instants), plus a
 * synchronous, calendar-anchored resolver for the closed `@` day
 * vocabulary and the open clock-time grammar that composes onto it.
 *
 * Resolution runs entirely client-side — no network, works with Ollama
 * unreachable. The backend's `resolve_date_phrase` covers a wider grammar
 * (Spanish, dayparts, spelled-out hours, `next` markers) and is only
 * reachable through the Assist router, so it can't serve a per-keystroke
 * dropdown. The overlap between the two is pinned by a shared test-vector
 * fixture (`shared/quick-add-date-vectors.json`), not by shared code.
 *
 * The clock is injected (`now`), never read here, so callers and tests stay
 * deterministic. The IANA zone a timed schedule is stamped with is passed
 * in the same way.
 */

import { instantOf } from "./dates";
import { type SigilPosition, wordStart } from "./sigilText";

/** The `@` day vocabulary, in the order the dropdown lists it. A closed
 * keyword set plus the seven weekday names — the menu is the only discovery
 * surface for it, which is why the dropdown opens on a bare `@` (unlike
 * `#`/`~`/`!`, whose vocabulary belongs to the user). */
export const DAY_TOKENS = [
  "today",
  "tomorrow",
  "weekend",
  "next-week",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type DayToken = (typeof DAY_TOKENS)[number];

/** Sunday-indexed, matching `Date.prototype.getDay()`. */
const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/** The time half of a schedule: a bare wall-clock time, resolved from a
 * `@8am` / `@8:30pm` / `@14:00` token. `hour` is 24-hour (0–23). */
export interface ClockTime {
  /** The token this resolved from, lower-cased — e.g. `8am`, `14:00`. */
  token: string;
  hour: number;
  minute: number;
}

/** A committed schedule chip. Carries both halves — the day (always) and an
 * optional clock time — plus the submit-ready wire values the composed
 * schedule maps to. A day-only chip keeps the backend's all-day
 * convention: a date-only instant at UTC midnight, no zone. A timed chip
 * is an ordinary scheduled Task: a concrete instant, `isAllDay` false, and
 * the browser's IANA zone. */
export interface ScheduleChip {
  /** The day-half vocabulary token — the chip's label root and its stable
   * identity. */
  token: string;
  /** The day half as a local calendar date, `YYYY-MM-DD`. */
  dayIso: string;
  /** The time half, or null for an all-day schedule. */
  time: ClockTime | null;
  /** Submit-ready due instant. All-day: `${dayIso}T00:00:00Z`. Timed: the
   * UTC instant of `dayIso` at `time`, read in `timeZone`. */
  dueDate: string;
  /** False once a clock time is attached. */
  isAllDay: boolean;
  /** IANA zone for a timed chip; null while all-day. */
  timeZone: string | null;
}

/** Resolves a weekday name or an unambiguous ≥3-letter abbreviation
 * (`mon`, `tue`, `thu`, `sat`, `sun`, …) to its Sunday-indexed day number.
 * The abbreviations only resolve a raw token typed straight to submit — the
 * dropdown always lists (and commits) the full names. */
function weekdayIndex(key: string): number | undefined {
  if (key in WEEKDAY_INDEX) {
    return WEEKDAY_INDEX[key];
  }
  if (key.length < 3) {
    return undefined;
  }
  const matches = Object.keys(WEEKDAY_INDEX).filter((name) => name.startsWith(key));
  return matches.length === 1 ? WEEKDAY_INDEX[matches[0] as string] : undefined;
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
}

function dayIsoOf(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** The all-day chip for a local calendar day (`YYYY-MM-DD`): a date-only
 * instant at UTC midnight, exactly as the backend's all-day convention
 * wants it, with no invented hour and no zone. */
function allDayChip(token: string, dayIso: string): ScheduleChip {
  return {
    token,
    dayIso,
    time: null,
    dueDate: `${dayIso}T00:00:00Z`,
    isAllDay: true,
    timeZone: null,
  };
}

/** Resolves one `@` day token against the injected `now`, calendar-anchored
 * (not offset-anchored): `next-week` is Monday of next week, not `now + 7`;
 * a weekday name is the *next* such weekday, strictly in the future, so
 * `monday` on a Monday is seven days out. `weekend` is the only token that
 * can resolve to today (on a Saturday or Sunday it means that weekend's
 * Saturday). Returns null for anything outside the closed vocabulary. */
export function resolveDayToken(token: string, now: Date): ScheduleChip | null {
  const key = token.toLowerCase();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = base.getDay();

  let target: Date | null = null;
  if (key === "today") {
    target = base;
  } else if (key === "tomorrow") {
    target = addDays(base, 1);
  } else if (key === "weekend") {
    // The upcoming Saturday. On a Sunday that Saturday is yesterday — this
    // weekend's — the one case any token resolves into the past-of-today.
    target = addDays(base, dow === 0 ? -1 : 6 - dow);
  } else if (key === "next-week") {
    // Monday of next week: step back to this week's Monday (weeks start
    // Monday), then a week on.
    const mondayThisWeek = addDays(base, dow === 0 ? -6 : 1 - dow);
    target = addDays(mondayThisWeek, 7);
  } else {
    const weekday = weekdayIndex(key);
    if (weekday !== undefined) {
      const delta = (weekday - dow + 7) % 7 || 7;
      target = addDays(base, delta);
    }
  }

  return target === null ? null : allDayChip(key, dayIsoOf(target));
}

/** Resolves a bare clock-time token — `8am`, `8:30pm`, `14:00`. A 12-hour
 * form needs its `am`/`pm`; a 24-hour form needs its colon, so a lone
 * `@8` stays ambiguous and is left in the title. Returns null for anything
 * that isn't a clock time. */
export function resolveClockTime(token: string): ClockTime | null {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(token.trim());
  if (match === null) {
    return null;
  }
  const meridiem = match[3]?.toLowerCase();
  const hasMinutes = match[2] !== undefined;
  const minute = hasMinutes ? Number(match[2]) : 0;
  if (minute > 59) {
    return null;
  }
  let hour = Number(match[1]);
  if (meridiem !== undefined) {
    if (hour < 1 || hour > 12) {
      return null;
    }
    hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
  } else {
    if (!hasMinutes || hour > 23) {
      return null;
    }
  }
  return { token: token.toLowerCase(), hour, minute };
}

/** Composes a time half onto a day-half chip (or clears it, when `time` is
 * null). A day token sets the day half, a time token sets the time half,
 * each overwriting only its own half.
 *
 * `timeZone` is the IANA zone the timed instant is stamped with. The
 * instant itself is computed in the host's local zone (via `instantOf`),
 * exactly as `dates.timedSchedule` does — v1 only ever schedules in the
 * browser's own zone, so the two are the same. */
export function composeSchedule(
  day: ScheduleChip,
  time: ClockTime | null,
  timeZone: string,
): ScheduleChip {
  if (time === null) {
    return allDayChip(day.token, day.dayIso);
  }
  const hhmm = `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
  return {
    token: day.token,
    dayIso: day.dayIso,
    time,
    dueDate: instantOf(day.dayIso, hhmm),
    isAllDay: false,
    timeZone,
  };
}

/** Merges an incoming pick into the standing chip — the `@` channel's
 * opt-in behaviour, the one channel that composes rather than replaces. A
 * day pick (no time) keeps whatever time was already set; a time pick
 * keeps the standing day. */
export function mergeSchedule(
  current: ScheduleChip,
  incoming: ScheduleChip,
  timeZone: string,
): ScheduleChip {
  return incoming.time !== null
    ? composeSchedule(current, incoming.time, timeZone)
    : composeSchedule(incoming, current.time, timeZone);
}

/** The `@` schedule a create call should use, shared by both Quick-Add
 * surfaces. A picked chip owns the day; a clock time typed raw after it
 * (`typedTime`) overwrites just the time half, so the two compose in either
 * order. With no chip, the parsed `@` tokens stand on their own. Null when
 * nothing scheduled it. */
export function resolveTokenSchedule(
  chip: ScheduleChip | undefined,
  parsedDue: ScheduleChip | null,
  typedTime: ClockTime | null,
  timeZone: string,
): ScheduleChip | null {
  if (chip === undefined) {
    return parsedDue;
  }
  return composeSchedule(chip, typedTime ?? chip.time, timeZone);
}

/** The chip's rendered label — the composed schedule, e.g. `Tomorrow` or
 * `Tomorrow 8:00 AM`. */
export function formatScheduleChipLabel(chip: ScheduleChip): string {
  const day = chip.token.charAt(0).toUpperCase() + chip.token.slice(1);
  if (chip.time === null) {
    return day;
  }
  const { hour, minute } = chip.time;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${day} ${h12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

export interface DateSuggestion {
  sigil: "@";
  /** Index of the sigil character itself. */
  start: number;
  /** Text typed after the sigil, up to the caret. */
  query: string;
  /** Resolved chips whose token starts with `query`, or the single
   * composed chip when `query` is a clock time. */
  options: ScheduleChip[];
  /** Always null — the vocabulary is closed, nothing can be created. */
  create: null;
}

/** Locates the `@` token the caret sits inside, if any, and resolves the
 * vocabulary tokens matching what's been typed so far against `now`. A
 * sigil only opens a query at the start of the input or right after
 * whitespace — `me@work` stays inert — and a space ends the query. A bare
 * `@` (empty query) lists the whole vocabulary. A query that reads as a
 * clock time (`8am`, `14:00`) resolves to a single time chip anchored on
 * today, which the merge hook composes onto any standing day. */
export function suggestDates(
  text: string,
  caret: number,
  now: Date,
  timeZone: string,
): DateSuggestion | null {
  const start = wordStart(text, caret);
  if (text[start] !== "@" || caret <= start) {
    return null;
  }
  const query = text.slice(start + 1, caret);
  const time = query === "" ? null : resolveClockTime(query);
  if (time !== null) {
    const today = resolveDayToken("today", now) as ScheduleChip;
    return {
      sigil: "@",
      start,
      query,
      options: [composeSchedule(today, time, timeZone)],
      create: null,
    };
  }
  const options = DAY_TOKENS.filter((token) => token.startsWith(query.toLowerCase())).map(
    (token) => resolveDayToken(token, now) as ScheduleChip,
  );
  return { sigil: "@", start, query, options, create: null };
}

export interface DatePick {
  /** The input text with the sigil and typed query removed. */
  text: string;
  /** Caret position after the removal — where the sigil used to start. */
  caret: number;
  /** The schedule committed as a chip. */
  schedule: ScheduleChip;
}

/** Applies a pick: strips the `@query` text the suggestion matched, leaving
 * anything typed after the caret untouched. */
export function applyDatePick(
  text: string,
  suggestion: SigilPosition,
  schedule: ScheduleChip,
): DatePick {
  const queryEnd = suggestion.start + 1 + suggestion.query.length;
  return {
    text: text.slice(0, suggestion.start) + text.slice(queryEnd),
    caret: suggestion.start,
    schedule,
  };
}
