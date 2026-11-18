import { useCallback, useRef, useState } from "react";

import { fetchCheckIns, fetchHabits, fetchHabitStats, putCheckIn, removeCheckIn } from "../api";
import type { Habit } from "../api";
import { localDayOf } from "../dates";
import { habitDueOn } from "../habitFrequency";
import { nextCheckIn } from "../habitStats";
import { RailCard } from "./DayRail";

interface HabitsCardProps {
  habitsHref: string;
  onOpenHabits: () => void;
}

interface TodayHabit {
  habit: Habit;
  value: number;
  streak: number;
}

/** Rail card: the Habits scheduled today with done count and one-tap Check-in (#447). */
export function HabitsCard({ habitsHref, onOpenHabits }: HabitsCardProps) {
  const today = localDayOf(new Date());
  // Bumping `version` hands RailCard a new `load`, which re-reads quietly.
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

  async function checkIn({ habit, value }: TodayHabit): Promise<void> {
    if (pending.current.has(habit.id)) return;
    pending.current.add(habit.id);
    try {
      const next = nextCheckIn(habit, value);
      if (next.clear) await removeCheckIn(habit.id, today);
      else await putCheckIn(habit.id, today, next.value);
      setVersion((n) => n + 1);
    } catch {
      // Leave the card as it was; the tap can be repeated.
    } finally {
      pending.current.delete(habit.id);
    }
  }

  function follow(event: React.MouseEvent<HTMLAnchorElement>): void {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    onOpenHabits();
  }

  return (
    <RailCard title="Habits" errorMessage="Couldn't load your Habits." load={load}>
      {(items) => {
        const done = items.filter((i) => i.value >= i.habit.target).length;
        return (
          <>
            <p className="rail-card-status">
              {items.length === 0 ? "No Habits scheduled today" : `${done} of ${items.length} done`}
            </p>
            <ul className="rail-habits">
              {items.map((item) => {
                const { habit, value, streak } = item;
                const complete = value >= habit.target;
                const unit = habit.unit === null ? "" : ` ${habit.unit}`;
                const progress =
                  habit.type === "boolean"
                    ? complete
                      ? "Done"
                      : null
                    : `${value}/${habit.target}${unit}`;
                const label =
                  habit.type === "boolean"
                    ? complete
                      ? `Undo ${habit.name}`
                      : `Check in ${habit.name}`
                    : complete
                      ? `Undo ${habit.name}`
                      : `Add ${habit.step} to ${habit.name}`;
                return (
                  <li key={habit.id} className="rail-habit">
                    <button
                      type="button"
                      className="btn-secondary rail-habit-check"
                      aria-label={label}
                      aria-pressed={complete}
                      onClick={() => void checkIn(item)}
                    >
                      {complete ? "✓" : "+"}
                    </button>
                    <span className="rail-habit-name">{habit.name}</span>
                    {progress !== null && <span className="rail-habit-progress">{progress}</span>}
                    <span className="rail-habit-streak">Streak: {streak}</span>
                  </li>
                );
              })}
            </ul>
            <a className="rail-card-link" href={habitsHref} onClick={follow}>
              Open Habits
            </a>
          </>
        );
      }}
    </RailCard>
  );
}
