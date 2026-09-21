import { useCallback, useEffect, useState } from "react";

import { fetchHabitStats, putCheckIn, removeCheckIn, type Habit, type HabitStats } from "../api";
import { formatDate, localDayOf } from "../dates";
import { heatLevel, nextCheckIn } from "../habitStats";
import { Hint } from "./Hint";
import { IconButton } from "./IconButton";

const pad = (n: number): string => String(n).padStart(2, "0");

/** The days of one month as YYYY-MM-DD strings. */
function monthDays(year: number, month: number): string[] {
  const count = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: count }, (_, i) => `${year}-${pad(month + 1)}-${pad(i + 1)}`);
}

interface HabitHistoryProps {
  habit: Habit;
  /** Fired after a backfill changes a Check-in, so the today screen refetches. */
  onChanged: () => void;
}

/** A Habit's history: the server-computed Streak, a monthly grid for
 * backfilling missed days, and the yearly heatmap. All numbers come from
 * GET /habits/{id}/stats — the component never recomputes them locally. */
export function HabitHistory({ habit, onChanged }: HabitHistoryProps): JSX.Element {
  const today = localDayOf(new Date());
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [month, setMonth] = useState(Number(today.slice(5, 7)) - 1);
  const [stats, setStats] = useState<HabitStats | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setStats(await fetchHabitStats(habit.id, today, year));
  }, [habit.id, today, year]);

  useEffect(() => {
    void load();
  }, [load]);

  // One lookup for both the grid and the heatmap: date -> heatmap entry.
  const entries = new Map((stats?.heatmap ?? []).map((entry) => [entry.date, entry]));
  const valueOf = (day: string): number => entries.get(day)?.value ?? 0;

  /** Backfill (or edit) a day's Check-in, on the same rule as the card's
   * recent-days strip (see nextCheckIn). */
  async function tapDay(day: string): Promise<void> {
    const next = nextCheckIn(habit, valueOf(day));
    await (next.clear ? removeCheckIn(habit.id, day) : putCheckIn(habit.id, day, next.value));
    await load();
    onChanged();
  }

  function stepMonth(delta: number): void {
    const next = new Date(year, month + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
  }

  const monthStart = new Date(year, month, 1);
  return (
    <div className="habit-history">
      <Hint hintKey="streak">
        <p className="habit-streak" tabIndex={0}>
          Streak: {stats?.streak ?? 0}
        </p>
      </Hint>
      <div className="habit-month">
        <div className="habit-month-nav">
          <IconButton icon="chevron-left" label="Previous month" onClick={() => stepMonth(-1)} />
          <span className="habit-month-label">{formatDate(monthStart, "month")}</span>
          <IconButton icon="chevron-right" label="Next month" onClick={() => stepMonth(1)} />
        </div>
        <div className="habit-month-grid">
          {monthDays(year, month).map((day, index) => {
            const value = valueOf(day);
            return (
              <button
                key={day}
                type="button"
                className={value >= habit.target ? "grid-day complete" : "grid-day"}
                aria-label={day}
                aria-pressed={value > 0}
                disabled={day > today}
                style={
                  // Align the 1st under its weekday (Monday-first, like the
                  // repeat editor's weekday order).
                  index === 0 ? { gridColumnStart: ((monthStart.getDay() + 6) % 7) + 1 } : undefined
                }
                onClick={() => void tapDay(day)}
              >
                {Number(day.slice(8, 10))}
              </button>
            );
          })}
        </div>
      </div>
      <div className="heatmap" role="img" aria-label="Yearly heatmap">
        {Array.from({ length: 12 }, (_, m) =>
          monthDays(year, m).map((day) => (
            <span
              key={day}
              title={day}
              className={`heatmap-day level-${heatLevel(entries.get(day)?.intensity ?? 0)}`}
            />
          )),
        )}
      </div>
    </div>
  );
}
