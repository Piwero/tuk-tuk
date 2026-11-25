/** Shared reading of the server-computed HabitStats (streak + heatmap) —
 * the yearly heatmap and the card's recent-days strip both bucket a
 * HeatmapDay's intensity the same way. */

import { localDayOf } from "./dates";
import { habitDueOn, recentScheduledDays } from "./habitFrequency";

/** The Habit start (YYYY-MM-DD): the first day the Habit counts. A day before
 * it reads as "not started", never as missed. The server's `eligible_from`
 * decides once the stats land; until then the creation day in the browser's
 * zone stands in. That is never earlier than the server's answer (an earlier
 * real Check-in can only pull it back), so a loading screen can't show a miss
 * the server wouldn't. Never after today. */
function habitStart(
  habit: { created_at: string },
  stats: { eligible_from: string } | null | undefined,
  today: string,
): string {
  const start = stats?.eligible_from ?? localDayOf(new Date(habit.created_at));
  return start < today ? start : today;
}

/** What one of a Habit's days is. The week grid, the recent-days strip and
 * the history panel all show days, so they all read them here. */
export type DayState =
  | "done"
  | "partial"
  | "open-today"
  | "missed"
  | "not-started"
  | "not-scheduled"
  | "paused"
  | "future";

/** Whether a pause covers the day: both ends inclusive, a null end
 * open-ended — the server's rule (app.habit_days). */
export function pauseCovers(
  pause: { start_date: string; end_date: string | null },
  day: string,
): boolean {
  return pause.start_date <= day && (pause.end_date === null || day <= pause.end_date);
}

/** The pause a Habit's card shows: the one covering today, else the next
 * one to come. Past pauses are history only, read off the days. */
export function currentOrNextPause<P extends { start_date: string; end_date: string | null }>(
  habit: { pauses?: P[] },
  today: string,
): P | undefined {
  return (habit.pauses ?? []).find((pause) => pause.end_date === null || pause.end_date >= today);
}

export interface DayReading {
  state: DayState;
  /** The heat-ramp fill (0..4). A partial day stays on 1-3, so only a met
   * Target ever looks like one. */
  level: number;
  /** The words a screen reader hears for the day, after its date. */
  text: string;
}

/** Reads one Habit's days as of `today`, with the Habit start worked out once
 * for all of them. `value` is what the day holds (0 when it has no
 * Check-in). The order decides overlaps: a recorded value always shows, a
 * future day is inert, an off day is "not scheduled" even before the Habit
 * start, and only then does the start turn an empty day "not started"
 * instead of missed, and a pause turns it "paused" — the same order as the
 * server's day rule (app.habit_days). Today is graced, as in the server's
 * Streak. */
export function habitDayReader(
  habit: {
    created_at: string;
    frequency: string;
    target: number;
    unit: string | null;
    pauses?: { start_date: string; end_date: string | null }[];
  },
  stats: { eligible_from: string } | null | undefined,
  today: string,
): (day: string, value: number) => DayReading {
  const start = habitStart(habit, stats, today);
  return (day, value) => {
    if (value >= habit.target) {
      return { state: "done", level: 4, text: "checked in" };
    }
    if (value > 0) {
      const unit = habit.unit === null ? "" : ` ${habit.unit}`;
      return {
        state: "partial",
        level: Math.min(3, Math.max(1, heatLevel(value / habit.target))),
        text: `in progress: ${value} of ${habit.target}${unit}`,
      };
    }
    if (day > today) {
      return { state: "future", level: 0, text: "future" };
    }
    if (!habitDueOn(habit.frequency, day)) {
      return { state: "not-scheduled", level: 0, text: "not scheduled" };
    }
    if (day < start) {
      return { state: "not-started", level: 0, text: "not started" };
    }
    if ((habit.pauses ?? []).some((pause) => pauseCovers(pause, day))) {
      return { state: "paused", level: 0, text: "paused" };
    }
    return day === today
      ? { state: "open-today", level: 0, text: "not yet checked in" }
      : { state: "missed", level: 0, text: "missed" };
  };
}

/** How many of the Habit's most recent scheduled days the card's strip
 * shows — three weeks, enough to read a pattern (a slipping habit, a
 * steady one) at a glance rather than just the current week. */
const STRIP_LENGTH = 21;

/** The days the card's recent-days strip covers, oldest first. The view
 * needs these too, to know which calendar years the strip reaches into. */
export function stripDays(frequency: string, today: string): string[] {
  return recentScheduledDays(frequency, today, STRIP_LENGTH);
}

/** The heatmap fill bucket (0..4) an intensity renders as. Level 0 is an
 * unfilled (missed, or not yet checked-in) day; a Numeric habit's partial
 * progress toward its Target lands on 1-3, a full Check-in on 4. */
export function heatLevel(intensityValue: number): number {
  return intensityValue <= 0 ? 0 : Math.min(Math.ceil(intensityValue * 4), 4);
}

/** What one tap on a day holding `value` does: a Boolean day toggles, a
 * Numeric day takes one more step, and a tap on a day that already met its
 * Target clears it. The card's recent-days strip and the history panel's
 * month grid are the same gesture on the same rule, so they read it here
 * rather than each deciding for itself. */
export function nextCheckIn(
  habit: { type: string; target: number; step: number },
  value: number,
): { clear: true } | { clear: false; value: number } {
  if (habit.type === "boolean") {
    return value > 0 ? { clear: true } : { clear: false, value: 1 };
  }
  return value >= habit.target ? { clear: true } : { clear: false, value: value + habit.step };
}
