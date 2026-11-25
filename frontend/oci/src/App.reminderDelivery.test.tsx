import { render, screen, waitFor, within } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeList, fakeReminderClaim, fakeTask, installFakeApi } from "./test/fakeApi";
import { installFakeNotifications } from "./test/fakeNotifications";

// Foreground Reminder delivery (issue #561, ADR 0019): while delivery is
// allowed, the open tab claims due Reminders from the server's ledger,
// shows each as a system notification, reports how that went, and a click
// opens the Task. Ledger deduplication and isolation are proven by the
// backend's HTTP tests against PostgreSQL; this fake only plays the server.

afterEach(() => vi.unstubAllGlobals());

const CLAIM = "/api/v1/reminder-deliveries/claim";

function claimRequests(api: ReturnType<typeof installFakeApi>): number {
  return api.requests.filter((r) => r.method === "POST" && r.url.startsWith(CLAIM)).length;
}

async function pollAgain(): Promise<void> {
  // A tab coming back into view claims at once rather than waiting.
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("Reminder delivery", () => {
  it("shows one notification for a due Reminder and reports it shown", async () => {
    const task = fakeTask("Call the dentist", {
      due_date: "2026-07-10T15:00:00Z",
      reminders: ["-PT30M"],
    });
    const api = installFakeApi({
      googleConfigured: false,
      reminderNotifications: true,
      tasks: [task],
      dueReminders: [fakeReminderClaim(task, "-PT30M")],
    });
    const notifications = installFakeNotifications({ permission: "granted" });
    render(<App />);

    await waitFor(() => expect(notifications.shown).toHaveLength(1));
    const shown = notifications.shown[0]!;
    expect(shown.title).toBe("Call the dentist");
    expect(shown.options?.body).toBe("30 minutes before");
    await waitFor(() =>
      expect(api.reminderReports).toEqual([
        {
          id: api.reminderClaims[0]!.id,
          outcome: "shown",
          lease_token: api.reminderClaims[0]!.lease_token,
        },
      ]),
    );
    const claimsSoFar = claimRequests(api);

    await pollAgain();

    await waitFor(() => expect(claimRequests(api)).toBeGreaterThan(claimsSoFar));
    expect(notifications.shown).toHaveLength(1);
    expect(api.requests.find((r) => r.url.startsWith(CLAIM))?.url).toMatch(/\?tz=/);
  });

  it("opens the Task when the notification is clicked", async () => {
    const errands = fakeList("Errands");
    const task = fakeTask("Pick up parcel", {
      list_id: errands.id,
      due_date: "2030-01-10T15:00:00Z",
      reminders: ["PT0S"],
    });
    installFakeApi({
      googleConfigured: false,
      reminderNotifications: true,
      lists: [errands],
      tasks: [task],
      dueReminders: [fakeReminderClaim(task, "PT0S")],
    });
    const notifications = installFakeNotifications({ permission: "granted" });
    const focus = vi.spyOn(window, "focus").mockImplementation(() => {});
    render(<App />);

    await waitFor(() => expect(notifications.shown).toHaveLength(1));
    const { notification } = notifications.shown[0]!;
    await act(async () => {
      notification.dispatchEvent(new Event("click"));
    });

    const panel = await screen.findByRole("complementary", { name: "Task details" });
    expect(within(panel).getByDisplayValue("Pick up parcel")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Errands" })).toBeInTheDocument();
    expect(focus).toHaveBeenCalled();
    expect(notification.closed).toBe(true);
  });

  it("reports a notification the browser refused as failed and keeps the app usable", async () => {
    const task = fakeTask("Water plants", {
      due_date: "2026-07-10T15:00:00Z",
      reminders: ["PT0S"],
    });
    const api = installFakeApi({
      googleConfigured: false,
      reminderNotifications: true,
      tasks: [task],
      dueReminders: [fakeReminderClaim(task, "PT0S")],
    });
    installFakeNotifications({ permission: "granted", display: "throw" });
    render(<App />);

    await waitFor(() => expect(api.reminderReports.map((r) => r.outcome)).toEqual(["failed"]));
    expect(await screen.findByRole("button", { name: "Quick add" })).toBeEnabled();
  });

  it("claims nothing while delivery is not allowed on this device", async () => {
    const task = fakeTask("Call the dentist", {
      due_date: "2026-07-10T15:00:00Z",
      reminders: ["PT0S"],
    });
    const api = installFakeApi({
      googleConfigured: false,
      reminderNotifications: true,
      tasks: [task],
      dueReminders: [fakeReminderClaim(task, "PT0S")],
    });
    const notifications = installFakeNotifications({ permission: "default" });
    render(<App />);

    await screen.findByRole("button", { name: "Quick add" });
    await pollAgain();
    expect(claimRequests(api)).toBe(0);
    expect(notifications.shown).toHaveLength(0);
  });
});
