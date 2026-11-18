import { useCallback, useRef, useState } from "react";

import { fetchCheckIns, fetchHabits, fetchHabitStats, putCheckIn, removeCheckIn } from "./api";
import type { Habit } from "./api";
import { localDayOf } from "./dates";
import { habitDueOn } from "./habitFrequency";
import { nextCheckIn } from "./habitStats";

export interface TodayHabit {
  habit: Habit;
  value: number;
  streak: number;
}

export interface TodayHabits {
  /** Reads today's scheduled Habits; a new identity after each Check-in. */
  load: () => Promise<TodayHabit[]>;
  /** One tap: Boolean checks in (or undoes), Numeric adds a step (#447, #461). */
  checkIn: (item: TodayHabit) => Promise<void>;
}

/** The single Check-in path for the Day rail Habits card and the mobile chip
 * strip. Call it once and hand the result to both, so a tap in one refreshes
 * the other and Streak/statistics come from the same writes. */
export function useTodayHabits(): TodayHabits {
  const today = localDayOf(new Date());
  const [version, setVersion] = useState(0);
  const pending = useRef<Set<number>>(new Set());
  const load = useCallback(async (): Promise<TodayHabit[]> => {
    void version;
    const [habitPage, checkInPage] = await Promise.all([fetchHabits(), fetchCheckIns(today)]);
    const due = habitPage.items.filter(
      (habit) => !habit.is_archived && habitDueOn(habit.frequency, today),
    );
    return Promise.all(
      due.map(async (habit) => ({
        habit,
        value: checkInPage.items.find((c) => c.habit_id === habit.id)?.value ?? 0,
        streak: (await fetchHabitStats(habit.id, today)).streak,
      })),
    );
  }, [today, version]);

  const checkIn = useCallback(
    async ({ habit, value }: TodayHabit): Promise<void> => {
      if (pending.current.has(habit.id)) return;
      pending.current.add(habit.id);
      try {
        const next = nextCheckIn(habit, value);
        if (next.clear) await removeCheckIn(habit.id, today);
        else await putCheckIn(habit.id, today, next.value);
        setVersion((n) => n + 1);
      } catch {
        // Leave things as they were; the tap can be repeated.
      } finally {
        pending.current.delete(habit.id);
      }
    },
    [today],
  );

  return { load, checkIn };
}

/** What a Check-in control shows and announces for one Habit. */
export function habitCheckInState({ habit, value }: TodayHabit): {
  complete: boolean;
  label: string;
  progress: string | null;
} {
  const complete = value >= habit.target;
  const unit = habit.unit === null ? "" : ` ${habit.unit}`;
  const progress =
    habit.type === "boolean" ? (complete ? "Done" : null) : `${value}/${habit.target}${unit}`;
  const label = complete
    ? `Undo ${habit.name}`
    : habit.type === "boolean"
      ? `Check in ${habit.name}`
      : `Add ${habit.step} to ${habit.name}`;
  return { complete, label, progress };
}
