/** Occurrence math for the fake API: mirrors the backend's dateutil-based
 * advance rules for the editor's RRULE subset, so component tests exercise
 * the same recurring-task behavior the real server shows. Test-only — the app
 * itself always takes the server's word via the PATCH response. */

import { parseRecurrence, type Recurrence, type Weekday } from "../recurrence";

/** One occurrence was completed: an "ends after N times" rule has N-1 left.
 * Never below 1 — a rule that produced a next occurrence still owes it. */
export function decrementCount(rule: string): string {
  return rule.replace(
    /COUNT=(\d+)/,
    (_, count: string) => `COUNT=${Math.max(Number(count) - 1, 1)}`,
  );
}

const JS_WEEKDAYS: Weekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const WEEK_MS = 7 * 86_400_000;

/** The next occurrence strictly after the due date, or null when the rule has
 * ended (COUNT spent or past UNTIL). Timed dates advance on local wall-clock
 * time (v1 schedules in the browser timezone); all-day dates are date-only.
 * Mirrors the backend's dateutil math for the editor's RRULE subset.
 */
export function nextOccurrenceISO(rule: string, dueISO: string, isAllDay: boolean): string | null {
  const recurrence = parseRecurrence(rule);
  if (recurrence === null) {
    return null;
  }
  // The due date is the rule's final occurrence: completing it ends the task.
  if (recurrence.end.kind === "count" && recurrence.end.times <= 1) {
    return null;
  }
  const due = new Date(dueISO);
  const candidate = nextCandidate(recurrence, due, isAllDay);
  if (candidate === null) {
    return null;
  }
  const day = isAllDay ? candidate.toISOString().slice(0, 10) : localDay(candidate);
  if (recurrence.end.kind === "until" && day > recurrence.end.day) {
    return null;
  }
  return isAllDay ? `${day}T00:00:00Z` : `${candidate.toISOString().slice(0, 19)}Z`;
}

function nextCandidate(recurrence: Recurrence, due: Date, isAllDay: boolean): Date | null {
  const { freq, interval, byday } = recurrence;
  if (freq === "DAILY") {
    return addDaysTo(due, interval, isAllDay);
  }
  if (freq === "WEEKLY") {
    if (byday.length === 0) {
      return addDaysTo(due, 7 * interval, isAllDay);
    }
    // Scan forward for a chosen weekday in a week aligned to the interval.
    // One extra week past the interval always contains a match.
    const weekOfDue = startOfWeek(due, isAllDay).getTime();
    for (let offset = 1; offset <= 7 * (interval + 1); offset += 1) {
      const candidate = addDaysTo(due, offset, isAllDay);
      const weeksApart = Math.round(
        (startOfWeek(candidate, isAllDay).getTime() - weekOfDue) / WEEK_MS,
      );
      if (weeksApart % interval === 0 && byday.includes(weekday(candidate, isAllDay))) {
        return candidate;
      }
    }
    return null;
  }
  if (freq === "MONTHLY") {
    // Months without the due's day-of-month are skipped (dateutil behavior);
    // day 29-31 recurs within 48 steps, so the horizon is never hit.
    for (let months = interval; months <= interval * 48; months += interval) {
      const candidate = addMonthsTo(due, months, isAllDay);
      if (candidate !== null) {
        return candidate;
      }
    }
    return null;
  }
  // Yearly: only Feb 29 ever skips, and it returns within 8 years.
  for (let years = interval; years <= interval * 8; years += interval) {
    const candidate = addMonthsTo(due, years * 12, isAllDay);
    if (candidate !== null) {
      return candidate;
    }
  }
  return null;
}

function localDay(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDaysTo(date: Date, days: number, utc: boolean): Date {
  const copy = new Date(date);
  if (utc) {
    copy.setUTCDate(copy.getUTCDate() + days);
  } else {
    copy.setDate(copy.getDate() + days);
  }
  return copy;
}

function addMonthsTo(date: Date, months: number, utc: boolean): Date | null {
  const copy = new Date(date);
  const month = utc ? copy.getUTCMonth() : copy.getMonth();
  const day = utc ? copy.getUTCDate() : copy.getDate();
  if (utc) {
    copy.setUTCDate(1);
    copy.setUTCMonth(month + months);
    copy.setUTCDate(day);
    return copy.getUTCDate() === day ? copy : null;
  }
  copy.setDate(1);
  copy.setMonth(month + months);
  copy.setDate(day);
  return copy.getDate() === day ? copy : null;
}

function weekday(date: Date, utc: boolean): Weekday {
  // getDay() is always 0..6, so the lookup never misses.
  return JS_WEEKDAYS[utc ? date.getUTCDay() : date.getDay()] as Weekday;
}

/** Monday 00:00 of the date's week (WKST=MO, the iCalendar default). */
function startOfWeek(date: Date, utc: boolean): Date {
  const copy = new Date(date);
  if (utc) {
    copy.setUTCHours(0, 0, 0, 0);
    copy.setUTCDate(copy.getUTCDate() - ((copy.getUTCDay() + 6) % 7));
  } else {
    copy.setHours(0, 0, 0, 0);
    copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7));
  }
  return copy;
}
