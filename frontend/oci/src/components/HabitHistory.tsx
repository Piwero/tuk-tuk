import { useCallback, useEffect, useState } from "react";

import { fetchHabitStats, putCheckIn, removeCheckIn, type Habit, type HabitStats } from "../api";
import { localDayOf } from "../dates";
import { Icon } from "./Icon";

// Fixed locale, deterministic under test (matches the app's other labels).
const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });

/** The heatmap fill bucket (0..4) an intensity renders as. */
function heatLevel(intensityValue: number): number {
  return intensityValue <= 0 ? 0 : Math.min(Math.ceil(intensityValue * 4), 4);
}

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

  /** Backfill (or edit) a day's Check-in: a Boolean tap toggles it; a Numeric
   * tap accumulates one step, and a tap on a complete day clears it. */
  async function tapDay(day: string): Promise<void> {
    const value = valueOf(day);
    if (habit.type === "boolean") {
      await (value > 0 ? removeCheckIn(habit.id, day) : putCheckIn(habit.id, day, 1));
    } else if (value >= habit.goal) {
      await removeCheckIn(habit.id, day);
    } else {
      await putCheckIn(habit.id, day, value + habit.step);
    }
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
      <p className="habit-streak">Streak: {stats?.streak ?? 0}</p>
      <div className="habit-month">
        <div className="habit-month-nav">
          <button type="button" aria-label="Previous month" onClick={() => stepMonth(-1)}>
            <Icon name="chevron-left" />
          </button>
          <span className="habit-month-label">{MONTH_YEAR.format(monthStart)}</span>
          <button type="button" aria-label="Next month" onClick={() => stepMonth(1)}>
            <Icon name="chevron-right" />
          </button>
        </div>
        <div className="habit-month-grid">
          {monthDays(year, month).map((day, index) => {
            const value = valueOf(day);
            return (
              <button
                key={day}
                type="button"
                className={value >= habit.goal ? "grid-day complete" : "grid-day"}
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
