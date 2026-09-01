/** Quick-Add `@date` suggestion dropdown and day-token resolution (issue
 * #211): pure text/caret logic the same shape as `tagSuggest.ts` /
 * `listSuggest.ts` / `prioritySuggest.ts`, plus a synchronous, calendar-
 * anchored resolver for the closed `@` day vocabulary.
 *
 * Resolution runs entirely client-side — no network, works with Ollama
 * unreachable. The backend's `resolve_date_phrase` covers a wider grammar
 * (Spanish, dayparts, clock times, `next` markers) and is only reachable
 * through the Assist router, so it can't serve a per-keystroke dropdown.
 * The overlap between the two is pinned by a shared test-vector fixture
 * (`shared/quick-add-date-vectors.json`), not by shared code.
 *
 * The clock is injected (`now`), never read here, so callers and tests stay
 * deterministic.
 */

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

/** A committed schedule: an all-day due date, expressed as the backend's
 * all-day convention wants it — a date-only instant at UTC midnight, with
 * no invented hour and no timezone. */
export interface ScheduleChip {
  /** The vocabulary token this resolved from — the chip's label and its
   * stable identity. */
  token: string;
  /** ISO-8601 instant at UTC midnight, e.g. `2026-09-07T00:00:00Z`. */
  dueDate: string;
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

function isoMidnightZ(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}T00:00:00Z`;
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

  return target === null ? null : { token: key, dueDate: isoMidnightZ(target) };
}

export interface DateSuggestion {
  sigil: "@";
  /** Index of the sigil character itself. */
  start: number;
  /** Text typed after the sigil, up to the caret. */
  query: string;
  /** Resolved vocabulary chips whose token starts with `query`. */
  options: ScheduleChip[];
  /** Always null — the vocabulary is closed, nothing can be created. */
  create: null;
}

/** Locates the `@` token the caret sits inside, if any, and resolves the
 * vocabulary tokens matching what's been typed so far against `now`. A
 * sigil only opens a query at the start of the input or right after
 * whitespace — `me@work` stays inert — and a space ends the query. A bare
 * `@` (empty query) lists the whole vocabulary. */
export function suggestDates(text: string, caret: number, now: Date): DateSuggestion | null {
  const start = wordStart(text, caret);
  if (text[start] !== "@" || caret <= start) {
    return null;
  }
  const query = text.slice(start + 1, caret);
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
