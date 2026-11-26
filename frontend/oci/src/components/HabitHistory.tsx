import "./HabitHistory.css";
import { useCallback, useEffect, useState } from "react";

import { fetchHabitStats, skipHabitDay, unskipHabitDay, type Habit, type HabitStats } from "../api";
import { tapCheckIn } from "../habitCheckIn";
import { formatDate, localDayOf } from "../dates";
import { habitDayReader, heatLevel } from "../habitStats";
import { HabitSkipForm } from "./HabitSkip";
import { HabitWeekTarget } from "./HabitWeekTarget";
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
  /** Fired after a backfill changes a Check-in, or a skip is added or
   * undone, so the today screen refetches. */
  onChanged: () => void;
}

/** A Habit's history: the server-computed Streak, a monthly grid for
 * backfilling missed days, and the yearly heatmap. All numbers come from
 * GET /habits/{id}/stats — the component never recomputes them locally. */
export function HabitHistory({ habit, onChanged }: HabitHistoryProps): React.JSX.Element {
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
  // Days before the Habit start read as "not started", never as misses. They
  // stay tappable: backfilling one is a real Check-in, and moves the start back.
  const read = habitDayReader(habit, stats, today);
  const notStarted = (day: string): boolean => read(day, valueOf(day)).state === "not-started";
  // A paused day (issue #559) is neither done nor missed, and refuses a
  // Check-in until its pause is changed.
  const paused = (day: string): boolean => read(day, valueOf(day)).state === "paused";
  // A skipped day (issue #564) is on purpose: neither done nor missed, and
  // it refuses a Check-in until the skip is undone.
  const skipped = (day: string): boolean => read(day, valueOf(day)).state === "skipped";
  const dayLabel = (day: string): string =>
    notStarted(day)
      ? `${day}: not started`
      : paused(day)
        ? `${day}: paused`
        : skipped(day)
          ? `${day}: skipped`
          : day;

  async function skipDay(day: string): Promise<void> {
    await skipHabitDay(habit.id, day);
    await load();
    onChanged();
  }

  async function undoSkip(day: string): Promise<void> {
    await unskipHabitDay(habit.id, day);
    await load();
    onChanged();
  }

  /** Backfill (or edit) a day's Check-in, on the same rule as the card's
   * recent-days strip (see tapCheckIn). */
  async function tapDay(day: string): Promise<void> {
    await tapCheckIn(habit, day, valueOf(day));
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
      {stats?.week && (
        <HabitWeekTarget label={`${habit.name} this week in history`} week={stats.week} />
      )}
      <div className="habit-month">
        <div className="habit-month-nav">
          <IconButton icon="chevron-left" label="Previous month" onClick={() => stepMonth(-1)} />
          <span className="habit-month-label">{formatDate(monthStart, "month")}</span>
          <IconButton icon="chevron-right" label="Next month" onClick={() => stepMonth(1)} />
        </div>
        <div className="habit-month-grid">
          {monthDays(year, month).map((day, index) => {
            const value = valueOf(day);
            const className = [
              "grid-day",
              value >= habit.target && "complete",
              notStarted(day) && "not-started",
              paused(day) && "paused",
              skipped(day) && "skipped",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                key={day}
                type="button"
                className={className}
                aria-label={dayLabel(day)}
                aria-pressed={value > 0}
                disabled={day > today || paused(day) || skipped(day)}
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
      <HabitSkipForm
        habitName={habit.name}
        today={today}
        skipped={monthDays(year, month).filter(skipped)}
        onSkip={skipDay}
        onUndo={undoSkip}
      />
      <p className="heatmap-caption">{year}: one square per day, from January 1</p>
      <div className="heatmap" role="img" aria-label="Yearly heatmap">
        {Array.from({ length: 12 }, (_, m) =>
          monthDays(year, m).map((day) => (
            <span
              key={day}
              title={day}
              className={`heatmap-day level-${heatLevel(entries.get(day)?.intensity ?? 0)}${notStarted(day) ? " not-started" : ""}${paused(day) ? " paused" : ""}${skipped(day) ? " skipped" : ""}`}
            />
          )),
        )}
      </div>
      <HistoryKey />
    </div>
  );
}

/** What the month grid's and the heatmap's marks mean, always on screen: a
 * heatmap square's date is only in its hover title, and a dash means
 * nothing until it is named. */
const HISTORY_KEY: { className: string; text: string }[] = [
  { className: "level-4", text: "Checked in" },
  { className: "level-2", text: "In progress" },
  { className: "level-0", text: "No Check-in" },
  { className: "level-0 not-started", text: "Not started: before the Habit began" },
  { className: "level-0 paused", text: "Paused: not counted, neither done nor missed" },
  {
    className: "level-0 skipped",
    text: "Skipped: on purpose, not counted, neither done nor missed",
  },
];

function HistoryKey(): React.JSX.Element {
  return (
    <ul className="habit-history-key" aria-label="What the history shows">
      {HISTORY_KEY.map(({ className, text }) => (
        <li key={text}>
          <span aria-hidden="true" className={`heatmap-day ${className}`} />
          {text}
        </li>
      ))}
    </ul>
  );
}
