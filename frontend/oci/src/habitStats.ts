/** Shared reading of the server-computed HabitStats (streak + heatmap) —
 * the yearly heatmap and the card's recent-days strip both bucket a
 * HeatmapDay's intensity the same way. */

import { localDayOf } from "./dates";
import { recentScheduledDays } from "./habitFrequency";

/** The Habit start (YYYY-MM-DD): the first day the Habit counts. A day before
 * it reads as "not started", never as missed. The server's `eligible_from`
 * decides once the stats land; until then the creation day in the browser's
 * zone stands in. That is never earlier than the server's answer (an earlier
 * real Check-in can only pull it back), so a loading screen can't show a miss
 * the server wouldn't. Never after today. */
export function habitStart(
  habit: { created_at: string },
  stats: { eligible_from: string } | null | undefined,
  today: string,
): string {
  const start = stats?.eligible_from ?? localDayOf(new Date(habit.created_at));
  return start < today ? start : today;
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
