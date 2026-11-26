import "./ReminderDeliveryNote.css";

import { reminderDeliveryNote, useReminderDelivery } from "../reminderDelivery";

/** One plain line beside Reminder chips saying whether they notify on this
 * device (issue #557), so a stored offset is never mistaken for an alert. */
export function ReminderDeliveryNote(): React.JSX.Element {
  const { state } = useReminderDelivery();
  return (
    <span className="reminder-delivery-note" data-state={state}>
      {reminderDeliveryNote(state)}
    </span>
  );
}
