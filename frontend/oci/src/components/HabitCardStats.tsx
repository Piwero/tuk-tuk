import { type Habit, type HabitStats } from "../api";
import { shortDayLabel } from "../dates";
import { recentScheduledDays } from "../habitFrequency";
import { heatLevel } from "../habitStats";
import { Icon } from "./Icon";

/** How many of the Habit's most recent scheduled days the card's strip
 * shows — three weeks, enough to read a pattern (a slipping habit, a
 * steady one) at a glance rather than just the current week. */
const STRIP_LENGTH = 21;

interface HabitCardStatsProps {
  habit: Habit;
  /** Undefined while the card's stats are still loading. */
  stats: HabitStats | undefined;
  /** The caller's local day (YYYY-MM-DD). */
  today: string;
}

/** A day cell's fill level plus its accessible status, read from the
 * HeatmapDay the server already computed (or its absence). */
function dayStatus(
  habit: Habit,
  today: string,
  day: string,
  entry: { value: number; intensity: number } | undefined,
): { level: number; text: string } {
  const level = heatLevel(entry?.intensity ?? 0);
  if (level >= 4) {
    return { level, text: "checked in" };
  }
  if (level > 0) {
    const unit = habit.unit === null ? "" : ` ${habit.unit}`;
    return { level, text: `in progress: ${entry?.value ?? 0} of ${habit.goal}${unit}` };
  }
  // Today is graced — the day isn't over, so it reads as pending, not missed
  // (the same grace the server's Streak gives it).
  return { level, text: day === today ? "not yet checked in" : "missed" };
}

/** The Streak and a strip of the Habit's most recent scheduled days —
 * checked in, missed, or (Numeric) partially filled toward the Goal. Reuses
 * habitFrequency's due-day logic, so a non-daily Habit's off days never
 * appear (and so never read as missed). Renders nothing until `stats`
 * loads. */
export function HabitCardStats({ habit, stats, today }: HabitCardStatsProps): JSX.Element | null {
  if (stats === undefined) {
    return null;
  }
  const entries = new Map(stats.heatmap.map((entry) => [entry.date, entry]));
  const days = recentScheduledDays(habit.frequency, today, STRIP_LENGTH);

  return (
    <div className="habit-card-stats">
      <span className="habit-streak-count">
        <Icon name="flame" size={14} />
        Streak: {stats.streak}
      </span>
      <div className="habit-strip" role="group" aria-label={`Recent days for ${habit.name}`}>
        {days.map((day) => {
          const { level, text } = dayStatus(habit, today, day, entries.get(day));
          return (
            <span
              key={day}
              role="img"
              className={`habit-strip-day heatmap-day level-${level}${day === today ? " today" : ""}`}
              aria-label={`${shortDayLabel(day)}: ${text}`}
            />
          );
        })}
      </div>
    </div>
  );
}
