// The weekly target reuses the pause's quiet status styles (HabitPause.css):
// paused and skipped days are choices, never failures.
import "./HabitPause.css";
import { type HabitWeek } from "../api";

interface HabitWeekTargetProps {
  /** The status's accessible name: "<Habit> this week", or a variant where
   * the same Habit's week shows twice (the history panel). */
  label: string;
  week: HabitWeek;
}

/** What paused or skipped days inside the week are called. */
function excludedDaysText(week: HabitWeek): string {
  if (week.paused_days > 0 && week.skipped_days > 0) {
    return "paused and skipped days don't";
  }
  return week.paused_days > 0 ? "paused days don't" : "skipped days don't";
}

/** A times-per-week Habit's week as the server reads it (issue #568): how
 * many days are done and how many remain. A pause or skip inside the week
 * never lowers the target, and the status says so in words, so a part-paused
 * week never reads as a quietly smaller one; lowering it is the User's
 * explicit frequency change. A week paused throughout is not counted. */
export function HabitWeekTarget({ label, week }: HabitWeekTargetProps): React.JSX.Element {
  if (week.excluded) {
    return (
      <div role="status" aria-label={label} className="habit-pause-status">
        <p className="habit-pause-interval">This week is paused: not counted toward the target</p>
      </div>
    );
  }
  const progress = week.remaining > 0 ? `${week.remaining} to go` : "target met";
  return (
    <div role="status" aria-label={label} className="habit-pause-status">
      <p className="habit-pause-interval">
        This week: {week.done} of {week.target} done, {progress}
      </p>
      {week.paused_days + week.skipped_days > 0 && (
        <p className="habit-pause-note">
          Target unchanged: {excludedDaysText(week)} lower it. Change the frequency to aim lower.
        </p>
      )}
    </div>
  );
}
