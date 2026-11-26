import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeTask, installFakeApi } from "./test/fakeApi";
import { installFakeNotifications, stubInsecureContext } from "./test/fakeNotifications";

// Reminder notifications (issue #557): delivery is an explicit, per-User
// opt-in, the browser prompt follows only the User's click, and the
// foreground-only limit is stated before they opt in.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const OPT_IN = "/api/v1/settings/reminder-notifications";

function claims(api: ReturnType<typeof installFakeApi>): number {
  return api.requests.filter((r) => r.url.startsWith("/api/v1/reminder-deliveries/claim")).length;
}

type User = ReturnType<typeof userEvent.setup>;

async function openSection(user: User): Promise<HTMLElement> {
  await user.click(await screen.findByRole("button", { name: "Account menu" }));
  await user.click(screen.getByRole("menuitem", { name: "My account" }));
  return screen.findByRole("region", { name: "Reminder notifications" });
}

describe("Reminder notifications setting", () => {
  it("is off by default, states the limit before the enable action, and never prompts on load", async () => {
    installFakeApi({ googleConfigured: false });
    const notifications = installFakeNotifications();
    const user = userEvent.setup();
    render(<App />);

    const section = await openSection(user);
    expect(within(section).getByRole("heading", { name: "Reminder notifications" })).toBeVisible();
    expect(within(section).getByText("Off")).toBeInTheDocument();
    const limit = within(section).getByText(/only while Tuk Tuk is open in a tab/);
    expect(limit).toHaveTextContent(/closed/);
    expect(limit).toHaveTextContent(/locked/);
    // A background tab still claims, so the copy may not promise it won't.
    expect(limit).toHaveTextContent(/background.*late or not at all.*not guaranteed/);
    expect(limit).not.toHaveTextContent(/don't arrive|won't arrive/);
    const enable = within(section).getByRole("button", { name: "Enable on this device" });
    expect(limit.compareDocumentPosition(enable) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notifications.requestPermission).not.toHaveBeenCalled();
  });

  it("asks the browser only after Enable on this device, then saves the opt-in", async () => {
    const api = installFakeApi({ googleConfigured: false });
    const notifications = installFakeNotifications({ holdPrompt: true });
    const user = userEvent.setup();
    render(<App />);

    const section = await openSection(user);
    expect(notifications.requestPermission).not.toHaveBeenCalled();
    await user.click(within(section).getByRole("button", { name: "Enable on this device" }));

    expect(notifications.requestPermission).toHaveBeenCalledTimes(1);
    expect(await within(section).findByText("Asking browser…")).toBeInTheDocument();
    expect(api.reminderNotifications).toBe(false);

    notifications.releasePrompt();
    expect(await within(section).findByText("On for this device")).toBeInTheDocument();
    await waitFor(() => expect(api.reminderNotifications).toBe(true));
    expect(
      within(section).queryByRole("button", { name: "Enable on this device" }),
    ).not.toBeInTheDocument();
  });

  it("can be turned off on every device", async () => {
    const api = installFakeApi({ googleConfigured: false, reminderNotifications: true });
    installFakeNotifications({ permission: "granted" });
    const user = userEvent.setup();
    render(<App />);

    const section = await openSection(user);
    expect(await within(section).findByText("On for this device")).toBeInTheDocument();
    await user.click(within(section).getByRole("button", { name: "Turn off on all devices" }));

    await waitFor(() => expect(api.reminderNotifications).toBe(false));
    expect(within(section).getByText("Off")).toBeInTheDocument();
  });

  it("stays off on a device not enabled here, though the User opted in elsewhere", async () => {
    const api = installFakeApi({
      googleConfigured: false,
      reminderNotifications: true,
      reminderDeviceEnabled: false,
    });
    const notifications = installFakeNotifications({ permission: "granted" });
    const user = userEvent.setup();
    render(<App />);

    const section = await openSection(user);
    expect(within(section).getByText("Off")).toBeInTheDocument();
    expect(claims(api)).toBe(0);

    await user.click(within(section).getByRole("button", { name: "Enable on this device" }));

    expect(await within(section).findByText("On for this device")).toBeInTheDocument();
    expect(notifications.requestPermission).not.toHaveBeenCalled();
    await waitFor(() => expect(claims(api)).toBeGreaterThan(0));
    expect(api.reminderNotifications).toBe(true);
  });

  it("turns off on this device only, leaving the User's opt-in for the others", async () => {
    const api = installFakeApi({ googleConfigured: false, reminderNotifications: true });
    installFakeNotifications({ permission: "granted" });
    const user = userEvent.setup();
    const { unmount } = render(<App />);

    const section = await openSection(user);
    expect(await within(section).findByText("On for this device")).toBeInTheDocument();
    await user.click(within(section).getByRole("button", { name: "Turn off on this device" }));

    expect(await within(section).findByText("Off")).toBeInTheDocument();
    expect(api.reminderNotifications).toBe(true);
    expect(api.requests.some((r) => r.method === "PUT" && r.url.includes(OPT_IN))).toBe(false);

    // Still off here after a reload: the choice is kept by this browser.
    unmount();
    render(<App />);
    const again = await openSection(user);
    expect(within(again).getByText("Off")).toBeInTheDocument();
  });

  it("treats a browser whose storage is unavailable as not enabled here", async () => {
    installFakeApi({ googleConfigured: false, reminderNotifications: true });
    installFakeNotifications({ permission: "granted" });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    const user = userEvent.setup();
    render(<App />);

    const section = await openSection(user);
    expect(within(section).getByText("Off")).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Enable on this device" })).toBeVisible();
  });

  it("on denial shows instructions, keeps delivery off, and never asks again", async () => {
    const api = installFakeApi({ googleConfigured: false });
    const notifications = installFakeNotifications({ answer: "denied" });
    const user = userEvent.setup();
    const { unmount } = render(<App />);

    let section = await openSection(user);
    await user.click(within(section).getByRole("button", { name: "Enable on this device" }));

    expect(await within(section).findByText("Blocked")).toBeInTheDocument();
    expect(within(section).getByText(/set Notifications to Allow/)).toBeInTheDocument();
    expect(within(section).getByText(/Tasks and Reminders keep working as usual/)).toBeVisible();
    expect(
      within(section).queryByRole("button", { name: "Enable on this device" }),
    ).not.toBeInTheDocument();
    expect(api.reminderNotifications).toBe(false);

    unmount();
    render(<App />);
    section = await openSection(user);
    expect(within(section).getByText("Blocked")).toBeInTheDocument();
    expect(notifications.requestPermission).toHaveBeenCalledTimes(1);
  });

  it("leaves Task capture and Reminder editing fully usable after denial", async () => {
    const meeting = fakeTask("Design review", {
      due_date: "2026-07-10T15:00:00Z",
      time_zone: "UTC",
    });
    const api = installFakeApi({ googleConfigured: false, tasks: [meeting] });
    installFakeNotifications({ answer: "denied" });
    const user = userEvent.setup();
    render(<App />);

    const section = await openSection(user);
    await user.click(within(section).getByRole("button", { name: "Enable on this device" }));
    await within(section).findByText("Blocked");

    await user.click(screen.getByRole("link", { name: "Inbox" }));
    await user.click(screen.getByRole("button", { name: "Quick add" }));
    const dialog = await screen.findByRole("dialog", { name: "Quick add" });
    await user.type(within(dialog).getByLabelText("Title"), "Call the plumber");
    await user.click(within(dialog).getByRole("button", { name: "Add task" }));
    await waitFor(() => expect(api.tasks.map((t) => t.title)).toContain("Call the plumber"));

    await user.click(await screen.findByRole("button", { name: "Open details for Design review" }));
    const panel = await screen.findByRole("complementary", { name: "Task details" });
    await user.click(within(panel).getByRole("button", { name: "Add reminder" }));
    await user.click(within(panel).getByRole("menuitem", { name: "1 hour before" }));
    const chips = await within(panel).findByRole("list", { name: "Reminders" });
    expect(within(chips).getByText("1 hour before")).toBeInTheDocument();
    await waitFor(() =>
      expect(api.tasks.find((t) => t.id === meeting.id)?.reminders).toEqual(["-PT1H"]),
    );
    expect(within(panel).getByText(/^Not notifications: this browser blocks/)).toBeVisible();
  });

  it("reports a browser without the Notification API as unsupported", async () => {
    installFakeApi({ googleConfigured: false });
    const user = userEvent.setup();
    render(<App />);

    const section = await openSection(user);
    expect(within(section).getByText("Not supported")).toBeInTheDocument();
    expect(within(section).getByText(/A current desktop browser can/)).toBeInTheDocument();
    expect(within(section).getByText(/Tasks and Reminders keep working as usual/)).toBeVisible();
    expect(
      within(section).queryByRole("button", { name: "Enable on this device" }),
    ).not.toBeInTheDocument();
  });

  it("reports an insecure context as unsupported and never prompts", async () => {
    installFakeApi({ googleConfigured: false });
    const notifications = installFakeNotifications();
    stubInsecureContext();
    const user = userEvent.setup();
    render(<App />);

    const section = await openSection(user);
    expect(within(section).getByText("Not supported")).toBeInTheDocument();
    expect(within(section).getByText(/isn't served over HTTPS/)).toBeInTheDocument();
    expect(
      within(section).queryByRole("button", { name: "Enable on this device" }),
    ).not.toBeInTheDocument();
    expect(notifications.requestPermission).not.toHaveBeenCalled();
  });
});

describe("Test notification", () => {
  it.each([
    { when: "off", opted: false, browser: "default", reason: /enabled on this device/ },
    { when: "denied", opted: false, browser: "denied", reason: /blocks notifications/ },
    { when: "unsupported", opted: false, browser: null, reason: /can't show notifications/ },
    {
      when: "opted in on another device only",
      opted: true,
      browser: "default",
      reason: /enabled on this device/,
    },
  ] as const)("is unavailable and says why when $when", async ({ opted, browser, reason }) => {
    installFakeApi({ googleConfigured: false, reminderNotifications: opted });
    if (browser !== null) installFakeNotifications({ permission: browser });
    const user = userEvent.setup();
    render(<App />);

    const section = await openSection(user);
    const send = within(section).getByRole("button", { name: "Send test notification" });
    expect(send).toBeDisabled();
    expect(send).toHaveAccessibleDescription(reason);
  });

  it("says Sent only once the browser reports the notification was shown", async () => {
    installFakeApi({ googleConfigured: false, reminderNotifications: true });
    const notifications = installFakeNotifications({ permission: "granted" });
    const user = userEvent.setup();
    render(<App />);

    const section = await openSection(user);
    const send = within(section).getByRole("button", { name: "Send test notification" });
    await waitFor(() => expect(send).toBeEnabled());
    await user.click(send);

    expect(notifications.shown.map((n) => n.title)).toEqual(["Tuk Tuk test notification"]);
    const status = await within(section).findByText(/^Sent\./);
    expect(status).toHaveTextContent(/depends on your system's notification settings/);
  });

  it.each(["error", "throw"] as const)(
    "reports a browser %s as an error, not as sent",
    async (display) => {
      installFakeApi({ googleConfigured: false, reminderNotifications: true });
      installFakeNotifications({ permission: "granted", display });
      const user = userEvent.setup();
      render(<App />);

      const section = await openSection(user);
      const send = within(section).getByRole("button", { name: "Send test notification" });
      await waitFor(() => expect(send).toBeEnabled());
      await user.click(send);

      expect(await within(section).findByRole("alert")).toHaveTextContent(
        "Your browser couldn't show the test notification.",
      );
      expect(within(section).queryByText(/^Sent/)).not.toBeInTheDocument();
    },
  );
});

describe("Reminder rows state their delivery honestly", () => {
  const meeting = (): ReturnType<typeof fakeTask> =>
    fakeTask("Design review", {
      due_date: "2026-07-10T15:00:00Z",
      time_zone: "UTC",
      reminders: ["-PT30M"],
    });

  async function openDetail(user: User): Promise<HTMLElement> {
    await user.click(await screen.findByRole("button", { name: "Open details for Design review" }));
    return screen.findByRole("complementary", { name: "Task details" });
  }

  it("reads as not notifications before opting in", async () => {
    installFakeApi({ tasks: [meeting()] });
    installFakeNotifications();
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail(user);
    expect(within(panel).getByText(/^Not notifications yet/)).toBeInTheDocument();
  });

  it("says it notifies on this device, while open, once enabled and allowed", async () => {
    installFakeApi({ tasks: [meeting()], reminderNotifications: true });
    installFakeNotifications({ permission: "granted" });
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail(user);
    expect(
      await within(panel).findByText("Notifies on this device while Tuk Tuk is open."),
    ).toBeInTheDocument();
  });

  it("reads as not notifications when the browser blocks them, even if opted in", async () => {
    installFakeApi({ tasks: [meeting()], reminderNotifications: true });
    installFakeNotifications({ permission: "denied" });
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail(user);
    expect(within(panel).getByText(/^Not notifications: this browser blocks/)).toBeInTheDocument();
  });

  it.each([false, true])(
    "labels the Quick add dialog's reminder chips (enabled: %s)",
    async (enabled) => {
      installFakeApi({
        reminderNotifications: enabled,
        assistAvailable: true,
        assistParseResult: {
          title: "pay rent",
          due_date: "2026-08-18T00:00:00Z",
          is_all_day: true,
          time_zone: null,
          recurrence: null,
          reminders: ["-P1D"],
          list_name: null,
          tag_names: [],
          priority: null,
        },
      });
      installFakeNotifications({ permission: "granted" });
      const user = userEvent.setup();
      render(<App />);

      await user.click(await screen.findByRole("link", { name: "Inbox" }));
      await user.click(screen.getByRole("button", { name: "Quick add" }));
      const dialog = await screen.findByRole("dialog", { name: "Quick add" });
      await user.type(within(dialog).getByLabelText("Title"), "pay rent remind me the day before");
      await within(dialog).findByLabelText("Assist available");
      await user.click(within(dialog).getByRole("button", { name: "Add task" }));

      const chips = await within(dialog).findByRole("group", { name: "Assist suggestions" });
      expect(within(chips).getByText("1 day before")).toBeInTheDocument();
      expect(
        within(dialog).getByText(
          enabled ? "Notifies on this device while Tuk Tuk is open." : /^Not notifications yet/,
        ),
      ).toBeInTheDocument();
    },
  );
});
