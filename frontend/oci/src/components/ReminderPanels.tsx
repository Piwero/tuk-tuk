import type { ReactNode } from "react";

import "./ReminderPanels.css";

/** The one fixed stack the floating Reminder panels share (Quiet hours
 * deferred, #567; delivered reminders, #566), so neither covers the other. */
export function ReminderPanels({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="reminder-panels">{children}</div>;
}
