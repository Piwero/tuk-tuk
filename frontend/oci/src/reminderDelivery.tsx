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
 * browser. This module delivers no Reminders itself; it only knows whether
 * delivery is set up, and can show a test notification.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { fetchReminderNotificationSettings, updateReminderNotificationSettings } from "./api";

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
