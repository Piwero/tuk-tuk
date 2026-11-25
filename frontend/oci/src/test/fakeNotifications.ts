import { vi, type Mock } from "vitest";

/** A stand-in for the browser's Notification API (issue #557). jsdom has
 * none, so by default the app sees an unsupported browser; a test that
 * wants a supported one installs this. It records what the app shows and
 * lets the test decide what the permission prompt answers and whether the
 * browser reports a display. Automated mocks never prove real OS delivery. */
export interface FakeNotifications {
  /** The browser's permission prompt; resolves to `answer`. */
  requestPermission: Mock<() => Promise<NotificationPermission>>;
  /** Every notification the app constructed, in order. */
  shown: { title: string; options: NotificationOptions | undefined }[];
  /** What the next prompt resolves to. */
  answer: NotificationPermission;
  /** Resolve a prompt the test is holding open (when `holdPrompt` is set). */
  releasePrompt: () => void;
}

interface Options {
  permission?: NotificationPermission;
  answer?: NotificationPermission;
  /** How the browser reacts to a constructed notification. */
  display?: "show" | "error" | "throw";
  /** Keep the prompt pending until `releasePrompt()` is called. */
  holdPrompt?: boolean;
}

export function installFakeNotifications({
  permission = "default",
  answer = "granted",
  display = "show",
  holdPrompt = false,
}: Options = {}): FakeNotifications {
  let release: () => void = () => {};
  const fake: FakeNotifications = {
    shown: [],
    answer,
    releasePrompt: () => release(),
    requestPermission: vi.fn(async () => {
      if (holdPrompt) await new Promise<void>((resolve) => (release = resolve));
      FakeNotification.permission = fake.answer;
      return fake.answer;
    }),
  };

  class FakeNotification extends EventTarget {
    static permission: NotificationPermission = permission;
    static requestPermission = fake.requestPermission;
    constructor(title: string, options?: NotificationOptions) {
      super();
      if (display === "throw") throw new TypeError("Illegal constructor");
      fake.shown.push({ title, options });
      setTimeout(() => this.dispatchEvent(new Event(display === "show" ? "show" : "error")), 0);
    }
    close(): void {}
  }

  vi.stubGlobal("Notification", FakeNotification);
  return fake;
}

/** An insecure origin (plain HTTP off localhost): the Notification API is
 * withheld there, so the app must report it as unsupported. */
export function stubInsecureContext(): void {
  vi.stubGlobal("isSecureContext", false);
}
