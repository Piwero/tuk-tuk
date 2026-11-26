import type { HeldReminder } from "../api";
import { localTimeOf } from "../dates";
import { reminderLabel } from "../reminders";
import "./QuietHoursDeferred.css";

/** The "quiet hours deferred" state (issue #567): which Reminders Quiet
 * hours are holding and when they come out, in plain text so the meaning
 * never rests on colour. Each row opens its Task. */
export function QuietHoursDeferred({
  held,
  quietUntil,
  onOpenTask,
}: {
  held: HeldReminder[];
  quietUntil: string | null;
  onOpenTask: (taskId: number) => void;
}): React.JSX.Element {
  const until = localTimeOf(new Date(quietUntil ?? held[0]!.deliver_at));
  const count = held.length === 1 ? "1 reminder" : `${held.length} reminders`;
  return (
    <section aria-label="Quiet hours deferred" className="quiet-hours-deferred">
      <p className="quiet-hours-deferred-title">
        Quiet hours: {count} held until {until}
      </p>
      <ul className="quiet-hours-deferred-list">
        {held.map((reminder) => (
          <li key={`${reminder.task_id}-${reminder.offset}`}>
            <button
              type="button"
              className="quiet-hours-deferred-task"
              onClick={() => onOpenTask(reminder.task_id)}
            >
              <span>{reminder.task_title}</span>
              <span className="quiet-hours-deferred-offset">{reminderLabel(reminder.offset)}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="quiet-hours-deferred-hint">They notify once when quiet hours end.</p>
    </section>
  );
}
