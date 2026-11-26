/** Reminder delivery on this device (issue #557).
 *
 * Two independent facts decide whether Reminders notify here: the User's
 * server-side opt-in (per User, off by default) and the browser's permission
 * (per device, owned by the browser). Only both together mean "allowed".
 * The browser prompt is requested only from `enable()`, which the Settings
 * button calls on an explicit click — never on load — and never again once
 * the browser has answered "denied".
 *
 * Scope is foreground only: a signed-in Tuk Tuk tab open on a supported
 * browser. The provider knows whether delivery is set up and can show a
 * test notification; DueReminderNotifier (issue #561) does the delivering.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  claimDueReminders,
  fetchReminderNotificationSettings,
  reportReminderDelivery,
  updateReminderNotificationSettings,
  type HeldReminder,
  type ReminderClaim,
} from "./api";
import { DeliveredReminders, type DeliveredReminder } from "./components/DeliveredReminders";
import { QuietHoursDeferred } from "./components/QuietHoursDeferred";
import { ReminderPanels } from "./components/ReminderPanels";
import { reminderLabel } from "./reminders";

export type ReminderDeliveryState = "off" | "requesting" | "allowed" | "denied" | "unsupported";

export interface ReminderDelivery {
  state: ReminderDeliveryState;
  /** Unsupported because the page isn't a secure context (plain HTTP). */
  insecure: boolean;
  /** The User's opt-in as stored on the server (null until loaded). */
  enabled: boolean | null;
  /** Set when saving the opt-in failed; cleared by the next attempt. */
  saveError: boolean;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
}

function isInsecure(): boolean {
  return window.isSecureContext === false;
}

function readPermission(): NotificationPermission | "unsupported" {
  if (isInsecure() || typeof window.Notification !== "function") return "unsupported";
  return window.Notification.permission;
}

const ReminderDeliveryContext = createContext<ReminderDelivery>({
  state: "off",
  insecure: false,
  enabled: null,
  saveError: false,
  enable: async () => {},
  disable: async () => {},
});

export function ReminderDeliveryProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [permission, setPermission] = useState(readPermission);
  const [requesting, setRequesting] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    let live = true;
    fetchReminderNotificationSettings()
      .then((settings) => live && setEnabled(settings.enabled))
      .catch(() => live && setEnabled(false));
    return () => {
      live = false;
    };
  }, []);

  const save = useCallback(async (next: boolean): Promise<void> => {
    setSaveError(false);
    try {
      setEnabled((await updateReminderNotificationSettings({ enabled: next })).enabled);
    } catch {
      setSaveError(true);
    }
  }, []);

  const enable = useCallback(async (): Promise<void> => {
    const current = readPermission();
    // Never re-prompt: a denied or unsupported browser keeps its answer.
    if (current === "unsupported" || current === "denied") return;
    if (current !== "granted") {
      setRequesting(true);
      let answer: NotificationPermission;
      try {
        answer = await window.Notification.requestPermission();
      } catch {
        answer = readPermission() === "granted" ? "granted" : "default";
      }
      setRequesting(false);
      setPermission(answer);
      if (answer !== "granted") return;
    }
    await save(true);
  }, [save]);

  const disable = useCallback(() => save(false), [save]);

  const state: ReminderDeliveryState =
    permission === "unsupported"
      ? "unsupported"
      : requesting
        ? "requesting"
        : permission === "denied"
          ? "denied"
          : enabled === true && permission === "granted"
            ? "allowed"
            : "off";

  return (
    <ReminderDeliveryContext.Provider
      value={{ state, insecure: isInsecure(), enabled, saveError, enable, disable }}
    >
      {children}
    </ReminderDeliveryContext.Provider>
  );
}

export function useReminderDelivery(): ReminderDelivery {
  return useContext(ReminderDeliveryContext);
}

/** What a Reminder row says about delivery here — plain text, so meaning
 * never rests on colour or an icon. */
export function reminderDeliveryNote(state: ReminderDeliveryState): string {
  switch (state) {
    case "allowed":
      return "Notifies on this device while Tuk Tuk is open.";
    case "denied":
      return "Not notifications: this browser blocks them for Tuk Tuk.";
    case "unsupported":
      return "Not notifications: this browser can't show them.";
    default:
      return "Not notifications yet. Turn on Reminder notifications in Settings.";
  }
}

/** How often an open tab asks the server for Reminders that came due. The
 * server's delivery window (5 minutes) leaves room for a background tab
 * whose timers the browser slows to once a minute. */
export const CLAIM_INTERVAL_MS = 30_000;

/** Delivers due Reminders on this device (issue #561, ADR 0019), only
 * while delivery is "allowed" here: the User's opt-in plus the browser's
 * permission. It claims on start, every CLAIM_INTERVAL_MS, and whenever
 * the tab comes back into view; the server's ledger makes sure each
 * occurrence goes to one tab. A failed claim (offline, signed out) is
 * dropped quietly: delivery is optional and never blocks the app. Clicking
 * a notification opens its Task. Each Reminder the browser showed also
 * stays in the app until dismissed, with Open task and Snooze (#566).
 * While Quiet hours hold Reminders (#567) it lists them too; they notify
 * once when the band ends. Both panels share one stack. */
export function DueReminderNotifier({
  onOpenTask,
}: {
  onOpenTask: (taskId: number) => void;
}): React.JSX.Element | null {
  const { state } = useReminderDelivery();
  const [delivered, setDelivered] = useState<DeliveredReminder[]>([]);
  const [held, setHeld] = useState<HeldReminder[]>([]);
  const [quietUntil, setQuietUntil] = useState<string | null>(null);
  const openTask = useRef(onOpenTask);
  useEffect(() => {
    openTask.current = onOpenTask;
  }, [onOpenTask]);

  useEffect(() => {
    if (state !== "allowed") return;
    let live = true;
    let claiming = false;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const claim = async (): Promise<void> => {
      if (claiming) return;
      claiming = true;
      try {
        const page = await claimDueReminders(timeZone);
        // Stopped meanwhile (turned off, signed out): show nothing; the
        // unreported leases expire on the server.
        if (!live) return;
        for (const item of page.items) {
          deliver(
            item,
            (id) => openTask.current(id),
            () => setDelivered((shown) => [...shown.filter((r) => r.id !== item.id), item]),
          );
        }
        setHeld(page.held ?? []);
        setQuietUntil(page.quiet_until ?? null);
      } catch {
        // Retried on the next tick.
      } finally {
        claiming = false;
      }
    };
    const onVisibility = (): void => {
      if (document.visibilityState === "visible") void claim();
    };
    void claim();
    const timer = setInterval(() => void claim(), CLAIM_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [state]);

  const showHeld = state === "allowed" && held.length > 0;
  if (!showHeld && delivered.length === 0) return null;
  return (
    <ReminderPanels>
      {showHeld && (
        <QuietHoursDeferred
          held={held}
          quietUntil={quietUntil}
          onOpenTask={(id) => openTask.current(id)}
        />
      )}
      <DeliveredReminders
        reminders={delivered}
        onOpenTask={(id) => openTask.current(id)}
        onDismiss={(id) => setDelivered((shown) => shown.filter((r) => r.id !== id))}
      />
    </ReminderPanels>
  );
}

/** Shows one claimed Reminder and reports what the browser says. The tag
 * is the ledger row's, so a retry the server hands out after a lost report
 * replaces the earlier alert rather than stacking a second one. */
function deliver(
  claim: ReminderClaim,
  onOpenTask: (taskId: number) => void,
  onShown: () => void,
): void {
  const report = (outcome: "shown" | "failed"): void => {
    reportReminderDelivery(claim, outcome).catch(() => {});
  };
  let notification: Notification;
  try {
    notification = new window.Notification(claim.task_title, {
      body: reminderLabel(claim.offset),
      tag: `tuk-tuk-reminder-${claim.id}`,
    });
  } catch {
    // Android Chrome, for one, has no page-level constructor (ADR 0019).
    report("failed");
    return;
  }
  notification.addEventListener(
    "show",
    () => {
      report("shown");
      onShown();
    },
    { once: true },
  );
  notification.addEventListener("error", () => report("failed"), { once: true });
  notification.addEventListener("click", () => {
    window.focus();
    notification.close();
    onOpenTask(claim.task_id);
  });
}

export type TestNotificationResult = "shown" | "error" | "unconfirmed";

/** How long to wait for the browser to confirm display before saying so. */
const CONFIRM_TIMEOUT_MS = 10_000;

/** Show a test notification and report what the browser confirms. "shown"
 * means the browser fired its show event — as far as a page can tell; it is
 * never proof the OS displayed it. */
export function showTestNotification(): Promise<TestNotificationResult> {
  return new Promise((resolve) => {
    let notification: Notification;
    try {
      notification = new window.Notification("Tuk Tuk test notification", {
        body: "Reminders will look like this while Tuk Tuk is open.",
        tag: "tuk-tuk-test",
      });
    } catch {
      resolve("error");
      return;
    }
    const timer = setTimeout(() => resolve("unconfirmed"), CONFIRM_TIMEOUT_MS);
    const settle = (result: TestNotificationResult) => () => {
      clearTimeout(timer);
      resolve(result);
    };
    notification.addEventListener("show", settle("shown"), { once: true });
    notification.addEventListener("error", settle("error"), { once: true });
  });
}
