import { type Habit, type HabitStats } from "../api";
import { shortDayLabel } from "../dates";
import { heatLevel, stripDays } from "../habitStats";
import { Icon } from "./Icon";

interface HabitCardStatsProps {
  habit: Habit;
  /** Undefined while the card's stats are still loading. */
  stats: HabitStats | undefined;
  /** The caller's local day (YYYY-MM-DD). */
  today: string;
  /** Fired when a day in the strip is tapped (YYYY-MM-DD). Null makes the
   * strip a picture rather than a control — an archived Habit is a record,
   * not something to still be checking in on. */
  onToggleDay: ((day: string) => void) | null;
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
    return { level, text: `in progress: ${entry?.value ?? 0} of ${habit.target}${unit}` };
  }
  // Today is graced — the day isn't over, so it reads as pending, not missed
  // (the same grace the server's Streak gives it).
  return { level, text: day === today ? "not yet checked in" : "missed" };
}

/** The Streak and a strip of the Habit's most recent scheduled days —
 * checked in, missed, or (Numeric) partially filled toward the Target. Reuses
 * habitFrequency's due-day logic, so a non-daily Habit's off days never
 * appear (and so never read as missed). Renders nothing until `stats`
 * loads.
 *
 * Each day is a control, not a picture: a missed day is fixed by tapping its
 * own square, so backfilling never means opening the history panel first. */
export function HabitCardStats({
  habit,
  stats,
  today,
  onToggleDay,
}: HabitCardStatsProps): JSX.Element | null {
  if (stats === undefined) {
    return null;
  }
  const entries = new Map(stats.heatmap.map((entry) => [entry.date, entry]));
  const days = stripDays(habit.frequency, today);

  return (
    <div className="habit-card-stats">
      <span className="habit-streak-count">
        <Icon name="flame" size={14} />
        Streak: {stats.streak}
      </span>
      <div className="habit-strip" role="group" aria-label={`Recent days for ${habit.name}`}>
        {days.map((day) => {
          const { level, text } = dayStatus(habit, today, day, entries.get(day));
          const className = `habit-strip-day heatmap-day level-${level}${day === today ? " today" : ""}`;
          const label = `${shortDayLabel(day)}: ${text}`;
          if (onToggleDay === null) {
            return <span key={day} role="img" className={className} aria-label={label} />;
          }
          return (
            <button
              key={day}
              type="button"
              className={className}
              aria-label={label}
              aria-pressed={level > 0}
              onClick={() => onToggleDay(day)}
            />
          );
        })}
      </div>
    </div>
  );
}
