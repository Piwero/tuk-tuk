import { putCheckIn, removeCheckIn, type CheckIn } from "./api";
import { nextCheckIn } from "./habitStats";

/** One tap on a Habit's day holding `value`, written through: clears the
 * Check-in or saves the next value (see nextCheckIn). The one write path for
 * the Habit card, its history panel and the Today rail. Resolves to the saved
 * Check-in, or null when the tap cleared it. */
export async function tapCheckIn(
  habit: { id: number; type: string; target: number; step: number },
  day: string,
  value: number,
): Promise<CheckIn | null> {
  const next = nextCheckIn(habit, value);
  if (next.clear) {
    await removeCheckIn(habit.id, day);
    return null;
  }
  return putCheckIn(habit.id, day, next.value);
}
