import "./MissedReminders.css";

import { useCallback, useEffect, useId, useState } from "react";

import { dismissMissedReminder, fetchMissedReminders, type MissedReminder } from "../api";
import { formatDate, fromDayIso, taskZonedDate } from "../dates";
import { CLAIM_INTERVAL_MS, useReminderDelivery } from "../reminderDelivery";
import { reminderLabel } from "../reminders";

function keyOf(missed: MissedReminder): string {
  return `${missed.task_id}|${missed.offset}|${missed.occurrence_due}`;
}

/** When the occurrence was due, read the way its Task shows its date. */
function dueLabel(missed: MissedReminder): string {
  return missed.is_all_day
    ? formatDate(fromDayIso(missed.occurrence_due.slice(0, 10)), "short")
    : formatDate(taskZonedDate(missed, missed.occurrence_due), "dateTime");
}

/** Missed reminders (issue #565, ADR 0019): Reminders whose delivery
 * window closed while no tab could show them. They are listed here on
 * return, never replayed as a burst of late system notifications. Each
 * entry names its Task (a link to it) and the occurrence it belonged to;
 * dismissing one records it on the server so it never comes back.
 *
 * Shown while the User's opt-in is on, even on a device that cannot
 * notify: the list is in-app. It refreshes on start, every claim interval
 * and when the tab comes back into view. A failed fetch keeps what is
 * shown: the list is a courtesy and never blocks the app. */
export function MissedReminders({
  onOpenTask,
}: {
  onOpenTask: (taskId: number) => void;
}): React.JSX.Element | null {
  const { enabled } = useReminderDelivery();
  const [items, setItems] = useState<MissedReminder[]>([]);
  const headingId = useId();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    if (enabled !== true) return;
    let live = true;
    const load = (): void => {
      fetchMissedReminders(timeZone).then(
        ({ items: fresh }) => live && setItems(fresh),
        () => {},
      );
    };
    const onVisibility = (): void => {
      if (document.visibilityState === "visible") load();
    };
    load();
    const timer = setInterval(load, CLAIM_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, timeZone]);

  const dismiss = useCallback(
    (missed: MissedReminder): void => {
      dismissMissedReminder(missed, timeZone).then(
        () => setItems((current) => current.filter((item) => keyOf(item) !== keyOf(missed))),
        () => {},
      );
    },
    [timeZone],
  );

  // Turned off meanwhile: nothing was meant to notify, so nothing is missed.
  const shown = enabled === true ? items : [];
  if (shown.length === 0) return null;

  return (
    <section className="missed-reminders" aria-labelledby={headingId}>
      <h2 id={headingId} className="missed-reminders-title">
        Missed reminders
      </h2>
      <p className="missed-reminders-note">
        These came due while Tuk Tuk was not open to notify you.
      </p>
      <ul className="missed-reminders-list">
        {shown.map((missed) => (
          <li key={keyOf(missed)} className="missed-reminder">
            <div className="missed-reminder-text">
              <button
                type="button"
                className="missed-reminder-task"
                onClick={() => onOpenTask(missed.task_id)}
              >
                {missed.task_title}
              </button>
              <span className="missed-reminder-context">
                {reminderLabel(missed.offset)} · Due {dueLabel(missed)}
              </span>
            </div>
            <button
              type="button"
              className="btn-quiet missed-reminder-dismiss"
              aria-label={`Dismiss missed reminder: ${missed.task_title}`}
              onClick={() => dismiss(missed)}
            >
              Dismiss
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
