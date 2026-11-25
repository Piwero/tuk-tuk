import { useState } from "react";

import {
  showTestNotification,
  useReminderDelivery,
  type ReminderDeliveryState,
  type TestNotificationResult,
} from "../reminderDelivery";

const STATUS: Record<ReminderDeliveryState, { text: string; tone: "on" | "off" | "warn" }> = {
  off: { text: "Off", tone: "off" },
  requesting: { text: "Asking browser…", tone: "off" },
  allowed: { text: "On for this device", tone: "on" },
  denied: { text: "Blocked", tone: "warn" },
  unsupported: { text: "Not supported", tone: "warn" },
};

const TEST_UNAVAILABLE: Record<Exclude<ReminderDeliveryState, "allowed">, string> = {
  off: "Available once notifications are enabled on this device.",
  requesting: "Available once your browser answers the permission prompt.",
  denied: "Unavailable: this browser blocks notifications for Tuk Tuk.",
  unsupported: "Unavailable: this browser can't show notifications.",
};

const TEST_RESULT: Record<TestNotificationResult | "sending", string> = {
  sending: "Sending…",
  shown:
    "Sent. Your browser reports it was shown; whether it appears also depends on your system's notification settings.",
  unconfirmed:
    "Sent, but your browser didn't confirm it was shown. Check your system's notification settings for this browser.",
  error:
    "Your browser couldn't show the test notification. Check your system's notification settings for this browser.",
};

/** Settings > Reminder notifications (issue #557). The foreground-only limit
 * comes before the enable action; the browser prompt follows only the
 * User's click; a denied or unsupported browser gets instructions, never a
 * second prompt. */
export function ReminderNotificationsSettings(): React.JSX.Element {
  const delivery = useReminderDelivery();
  const { state } = delivery;
  const [test, setTest] = useState<TestNotificationResult | "sending" | null>(null);

  async function sendTest(): Promise<void> {
    setTest("sending");
    setTest(await showTestNotification());
  }

  const status = STATUS[state];
  return (
    <>
      <div className="settings-section-head">
        <h2>Reminder notifications</h2>
        <span className="settings-status" data-state={status.tone}>
          {status.text}
        </span>
      </div>
      <div className="settings-field">
        <p className="settings-hint">
          Notifications arrive only while Tuk Tuk is open in a tab, signed in, on a supported
          browser. They don't arrive when the browser is in the background or closed, or when your
          device is locked.
        </p>
        {state === "off" && (
          <div>
            <button type="button" className="btn-primary" onClick={() => void delivery.enable()}>
              Enable on this device
            </button>
          </div>
        )}
        {state === "requesting" && (
          <p className="settings-hint" role="status">
            Waiting for your browser's permission prompt…
          </p>
        )}
        {state === "denied" && (
          <div className="settings-hint">
            <p className="settings-hint">
              Your browser blocked notifications for Tuk Tuk, so it won't ask again. To allow them,
              open this site's settings in your browser (usually the icon beside the address), set
              Notifications to Allow, then reload Tuk Tuk.
            </p>
          </div>
        )}
        {state === "unsupported" && (
          <p className="settings-hint">
            {delivery.insecure
              ? "This browser can't show notifications here because Tuk Tuk isn't served over HTTPS. Ask whoever runs this server to set up HTTPS."
              : "This browser can't show notifications. A current desktop browser can."}
          </p>
        )}
        {(state === "denied" || state === "unsupported") && (
          <p className="settings-hint">
            Your Tasks and Reminders keep working as usual; Reminders just won't notify on this
            device.
          </p>
        )}
        {delivery.enabled === true && state !== "unsupported" && (
          <div>
            <button type="button" className="btn-quiet" onClick={() => void delivery.disable()}>
              Turn off notifications
            </button>
          </div>
        )}
        {delivery.saveError && <p role="alert">Couldn't save this setting. Try again.</p>}
        <div>
          <button
            type="button"
            className="btn-quiet"
            disabled={state !== "allowed" || test === "sending"}
            aria-describedby={state === "allowed" ? undefined : "reminder-test-unavailable"}
            onClick={() => void sendTest()}
          >
            Send test notification
          </button>
        </div>
        {state !== "allowed" && (
          <p className="settings-hint" id="reminder-test-unavailable">
            {TEST_UNAVAILABLE[state]}
          </p>
        )}
        {state === "allowed" && test !== null && (
          <p className="settings-hint" role={test === "error" ? "alert" : "status"}>
            {TEST_RESULT[test]}
          </p>
        )}
      </div>
    </>
  );
}
