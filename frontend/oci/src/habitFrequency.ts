/** Habit frequency: the RRULE subset Habits are scheduled by — daily, chosen
 * weekdays, or N times per week (TickTick's TT_TIMES extension). Frequencies
 * answer "is this Habit due today?", never a date series, so this mirrors the
 * backend's app.habit_frequency module rather than the Task recurrence editor.
 */

import { addDays, fromDayIso } from "./dates";
import { WEEKDAY_LABELS, WEEKDAYS, type Weekday } from "./recurrence";

export type HabitFrequency =
  | { kind: "daily" }
  | { kind: "weekdays"; byday: Weekday[] }
  | { kind: "timesPerWeek"; times: number };

export function serializeHabitFrequency(frequency: HabitFrequency): string {
  if (frequency.kind === "daily") {
    return "FREQ=DAILY";
  }
  if (frequency.kind === "weekdays") {
    return `FREQ=WEEKLY;BYDAY=${frequency.byday.join(",")}`;
  }
  return `FREQ=WEEKLY;TT_TIMES=${frequency.times}`;
}

/** Parse frequency content back into editor state; null when the rule uses
 * anything beyond the habit subset. */
export function parseHabitFrequency(rule: string): HabitFrequency | null {
  const parts = new Map<string, string>();
  for (const part of rule.split(";")) {
    const [key, value] = part.split("=");
    if (key === undefined || value === undefined || parts.has(key)) {
      return null;
    }
    parts.set(key, value);
  }
  if (parts.get("FREQ") === "DAILY" && parts.size === 1) {
    return { kind: "daily" };
  }
  if (parts.get("FREQ") !== "WEEKLY" || parts.size !== 2) {
    return null;
  }
  const byday = parts.get("BYDAY");
  if (byday !== undefined) {
    const days = byday.split(",");
    if (!days.every((day) => WEEKDAYS.includes(day as Weekday))) {
      return null;
    }
    return { kind: "weekdays", byday: days as Weekday[] };
  }
  const times = Number(parts.get("TT_TIMES"));
  if (!Number.isInteger(times) || times < 1 || times > 7) {
    return null;
  }
  return { kind: "timesPerWeek", times };
}

/** Whether a Habit with this frequency is scheduled on the given local day
 * (YYYY-MM-DD). Daily and N-times-per-week habits are due every day — the
 * user picks which days count toward the N; weekday habits only on theirs. */
export function habitDueOn(rule: string, dayIso: string): boolean {
  const frequency = parseHabitFrequency(rule);
  if (frequency === null || frequency.kind !== "weekdays") {
    return true;
  }
  // date.getDay() counts from Sunday; WEEKDAYS starts at Monday.
  const weekday = WEEKDAYS[(fromDayIso(dayIso).getDay() + 6) % 7] as Weekday;
  return frequency.byday.includes(weekday);
}

/** The most recent `count` days this Habit is scheduled on, oldest first,
 * walking back from (and including) `today`. Non-daily habits skip their
 * off days entirely rather than padding them in, so the card's recent-days
 * strip never reads an unscheduled day as missed. */
export function recentScheduledDays(rule: string, today: string, count: number): string[] {
  const days: string[] = [];
  let cursor = today;
  let guard = 0;
  // A once-a-week habit needs several weeks back to fill the strip; the
  // guard just bounds the walk so a malformed rule can't loop forever.
  while (days.length < count && guard < 400) {
    if (habitDueOn(rule, cursor)) {
      days.push(cursor);
    }
    cursor = addDays(cursor, -1);
    guard += 1;
  }
  return days.reverse();
}

/** A readable label: "Every day", "On Mon, Thu", "3 times a week". */
export function habitFrequencyLabel(rule: string): string {
  const frequency = parseHabitFrequency(rule);
  if (frequency === null) {
    return rule;
  }
  if (frequency.kind === "daily") {
    return "Every day";
  }
  if (frequency.kind === "weekdays") {
    return `On ${frequency.byday.map((day) => WEEKDAY_LABELS[day]).join(", ")}`;
  }
  return frequency.times === 1 ? "Once a week" : `${frequency.times} times a week`;
}
