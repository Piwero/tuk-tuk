import "./HabitHistory.css";
import "./HabitCardStats.css";
import { type Habit, type HabitStats } from "../api";
import { shortDayLabel } from "../dates";
import { habitDayReader, stripDays } from "../habitStats";
import { useHoverHint } from "../useHoverHint";
import { Hint } from "./Hint";
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
  /** False where the Streak is already shown beside the strip (the week grid). */
  showStreak?: boolean;
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
  showStreak = true,
}: HabitCardStatsProps): React.JSX.Element | null {
  if (stats === undefined) {
    return null;
  }
  const values = new Map(stats.heatmap.map((entry) => [entry.date, entry.value]));
  const days = stripDays(habit.frequency, today);
  const read = habitDayReader(habit, stats, today);

  return (
    <div className="habit-card-stats">
      {showStreak && (
        <Hint hintKey="streak">
          <span className="habit-streak-count">
            <Icon name="flame" size={14} />
            Streak: {stats.streak}
          </span>
        </Hint>
      )}
      <div className="habit-strip" role="group" aria-label={`Recent days for ${habit.name}`}>
        {days.map((day) => {
          const { state, level, text } = read(day, values.get(day) ?? 0);
          const className = `habit-strip-day heatmap-day level-${level}${state === "not-started" ? " not-started" : ""}${state === "paused" ? " paused" : ""}${day === today ? " today" : ""}`;
          const label = `${shortDayLabel(day)}: ${text}`;
          return (
            <StripDay
              key={day}
              className={className}
              label={label}
              level={level}
              // A paused day refuses a Check-in, so it is a picture too.
              onToggle={onToggleDay === null || state === "paused" ? null : () => onToggleDay(day)}
            />
          );
        })}
      </div>
    </div>
  );
}

/** One square of the history strip. Its accessible name is the only source
 * of the hover/focus hint's copy — the two can't drift, since one string
 * feeds both. */
function StripDay({
  className,
  label,
  level,
  onToggle,
}: {
  className: string;
  label: string;
  level: number;
  onToggle: (() => void) | null;
}): React.JSX.Element {
  const { open, handlers } = useHoverHint();
  return (
    <span className="habit-strip-day-wrap">
      {onToggle === null ? (
        <span role="img" className={className} aria-label={label} {...handlers} />
      ) : (
        <button
          type="button"
          className={className}
          aria-label={label}
          aria-pressed={level > 0}
          onClick={onToggle}
          {...handlers}
        />
      )}
      {open && (
        <span role="tooltip" className="habit-strip-day-hint">
          {label}
        </span>
      )}
    </span>
  );
}
