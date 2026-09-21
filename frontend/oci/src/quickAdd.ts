/** Quick-Add token parsing: `#tag`, `!priority` and `~list`, parsed
 * deterministically and stripped from the saved title. No natural-language
 * date parsing in v1 (see the PRD).
 */

import { type Priority, type TaskList } from "./api";
import {
  type ClockTime,
  composeSchedule,
  resolveClockTime,
  resolveDayToken,
  type ScheduleChip,
} from "./dateSuggest";
import { browserTimeZone } from "./dates";

export interface QuickAddPlan {
  /** The input with all consumed tokens stripped (whitespace collapsed). */
  title: string;
  /** From the first `!high` / `!medium` / `!low` token, or null. */
  priority: Priority | null;
  /** From the first `~name` token matching a List, or null. */
  listId: number | null;
  /** `#tag` names in first-seen order, deduplicated case-insensitively. */
  tagNames: string[];
  /** The composed `@` schedule — a day half (`@tomorrow`) and/or a clock
   * time (`@8am`), each token overwriting only its own half. Null when no
   * `now` was supplied (date tokens are then left in the title untouched)
   * or nothing resolved. A time with no day means today. */
  due: ScheduleChip | null;
  /** The raw clock-time half on its own, exposed so a caller holding a
   * picked day chip (which makes `skipDateToken` true) can still compose a
   * typed `@8am` onto it. Null when no time token was typed. */
  dueTime: ClockTime | null;
}

const PRIORITY_TOKENS: Record<string, Priority> = {
  "!high": "high",
  "!medium": "medium",
  "!low": "low",
};

/** Case-insensitive name equality — how tokens match Lists and Tags. */
export const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Words that commonly show up in a spoken-English date/time phrase — day
 * names, relative-day words, month names, and a clock-time shape like
 * `3pm` / `3:30`. This is a static keyword/regex check, not date parsing
 * (issue #259): it never extracts or resolves a date, it only flags that
 * the saved title *reads like* one so the "no date was set" toast can say
 * so, rather than staying silent about text Quick-Add's `@` vocabulary
 * didn't recognise. Deliberately over-inclusive — a false positive just
 * means an offered "Add date" action the user ignores. */
const DATE_WORD_RE =
  /\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\b/i;
const CLOCK_TIME_RE = /\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i;

/** True when `title` — the text Quick-Add is about to save verbatim —
 * contains a date/time-shaped word or phrase. Used only to decide whether
 * to surface a "no date set" hint after a capture with no resolved
 * schedule; never used to resolve one. */
export function looksLikeDatePhrase(title: string): boolean {
  return DATE_WORD_RE.test(title) || CLOCK_TIME_RE.test(title);
}

export interface ParseQuickAddOptions {
  /** True once a `~list` chip has already been picked from the dropdown —
   * the deliberate pick wins, so a raw `~token` is left in the title
   * untouched rather than silently claiming the slot too. */
  skipListToken?: boolean;
  /** Same, for a `!priority` chip already picked from the dropdown. */
  skipPriorityToken?: boolean;
  /** Same, for an `@day` schedule chip already picked from the dropdown —
   * suppresses only the *day* half; a typed clock time still resolves, so
   * it can be composed onto the picked day. */
  skipDateToken?: boolean;
  /** The clock `@day` tokens resolve against. Absent (the palette, the
   * Quick-Add dialog, the calendar draft — all of which carry their own
   * date) means `@day` tokens are left in the title verbatim, exactly as
   * before this sigil existed. */
  now?: Date;
}

/** Tokens are consumed at most once (first wins); anything not consumed —
 * unknown `!word`, unmatched or repeated `~list` — stays in the title
 * verbatim, so nothing typed is silently lost. */
export function parseQuickAdd(
  input: string,
  lists: TaskList[],
  options: ParseQuickAddOptions = {},
): QuickAddPlan {
  const plan: QuickAddPlan = {
    title: "",
    priority: null,
    listId: null,
    tagNames: [],
    due: null,
    dueTime: null,
  };
  const rest: string[] = [];
  let dayHalf: ScheduleChip | null = null;
  let timeHalf: ClockTime | null = null;
  for (const word of input.split(/\s+/)) {
    if (word.startsWith("#") && word.length > 1) {
      const name = word.slice(1);
      if (!plan.tagNames.some((seen) => sameName(seen, name))) {
        plan.tagNames.push(name);
      }
      continue;
    }
    if (!options.skipPriorityToken) {
      const priority = PRIORITY_TOKENS[word.toLowerCase()];
      if (priority !== undefined && plan.priority === null) {
        plan.priority = priority;
        continue;
      }
    }
    if (options.now !== undefined && word.startsWith("@") && word.length > 1) {
      const body = word.slice(1);
      if (!options.skipDateToken) {
        const resolvedDay = resolveDayToken(body, options.now);
        if (resolvedDay !== null) {
          // Last day token wins — a later `@monday` replaces an earlier
          // `@tomorrow` and keeps any time half, mirroring the dropdown's
          // merge behaviour.
          dayHalf = resolvedDay;
          continue;
        }
      }
      const resolvedTime = resolveClockTime(body);
      if (resolvedTime !== null) {
        timeHalf = resolvedTime;
        continue;
      }
    }
    if (!options.skipListToken && word.startsWith("~") && word.length > 1 && plan.listId === null) {
      const match = lists.find((list) => sameName(list.name, word.slice(1)));
      if (match !== undefined) {
        plan.listId = match.id;
        continue;
      }
    }
    if (word !== "") {
      rest.push(word);
    }
  }
  if (options.now !== undefined && (dayHalf !== null || timeHalf !== null)) {
    const base = dayHalf ?? (resolveDayToken("today", options.now) as ScheduleChip);
    plan.due = composeSchedule(base, timeHalf, browserTimeZone());
  }
  plan.dueTime = timeHalf;
  plan.title = rest.join(" ");
  return plan;
}
