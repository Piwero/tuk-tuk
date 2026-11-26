import type { ReactNode } from "react";

import "./ReminderPanels.css";

/** The one fixed stack the floating Reminder panels share (Quiet hours
 * deferred, #567; delivered reminders, #566), so neither covers the other.
 * It is also their polite live region (#569): a panel appearing in it is
 * read out without moving focus. */
export function ReminderPanels({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="reminder-panels" aria-live="polite">
      {children}
    </div>
  );
}
