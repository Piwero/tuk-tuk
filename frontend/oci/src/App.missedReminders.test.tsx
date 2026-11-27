import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeList, fakeMissedReminder, fakeTask, installFakeApi } from "./test/fakeApi";
import { installFakeNotifications } from "./test/fakeNotifications";

// Missed reminders (issue #565, ADR 0019): Reminders that came due while no
// tab was open are listed in the app on return, never replayed as a burst
// of late system notifications. Which Reminders count as missed, stale
// occurrences, dismissal and isolation are proven by the backend's HTTP
// tests against PostgreSQL; this fake only plays the server.

afterEach(() => vi.unstubAllGlobals());

const MISSED = "/api/v1/reminder-deliveries/missed";

function missedRequests(api: ReturnType<typeof installFakeApi>): number {
  return api.requests.filter((r) => r.method === "GET" && r.url.startsWith(MISSED)).length;
}

describe("Missed reminders", () => {
  it("lists several missed reminders on reopening, with no system notification", async () => {
    const errands = fakeList("Errands");
    const dentist = fakeTask("Call the dentist", {
      due_date: "2026-07-10T15:00:00Z",
      reminders: ["-PT30M"],
    });
    const parcel = fakeTask("Pick up parcel", {
      list_id: errands.id,
      due_date: "2026-07-09T09:00:00Z",
      reminders: ["PT0S", "-P1D"],
    });
    const api = installFakeApi({
      googleConfigured: false,
      reminderNotifications: true,
      lists: [errands],
      tasks: [dentist, parcel],
      missedReminders: [
        fakeMissedReminder(dentist, "-PT30M"),
        fakeMissedReminder(parcel, "PT0S"),
        fakeMissedReminder(parcel, "-P1D"),
      ],
    });
    const notifications = installFakeNotifications({ permission: "granted" });
    render(<App />);

    const region = await screen.findByRole("region", { name: "Missed reminders" });
    const entries = await within(region).findAllByRole("listitem");
    expect(entries).toHaveLength(3);
    expect(entries[0]).toHaveTextContent("Call the dentist");
    expect(entries[0]).toHaveTextContent("30 minutes before");
    expect(entries[0]).toHaveTextContent(/Due Jul 10/);
    expect(entries[2]).toHaveTextContent("1 day before");
    expect(api.requests.find((r) => r.url.startsWith(MISSED))?.url).toMatch(/\?tz=/);
    expect(notifications.shown).toHaveLength(0);

    await userEvent.click(within(entries[1]!).getByRole("button", { name: "Pick up parcel" }));

    const panel = await screen.findByRole("complementary", { name: "Task details" });
    expect(within(panel).getByDisplayValue("Pick up parcel")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Errands" })).toBeInTheDocument();
    expect(notifications.shown).toHaveLength(0);
  });

  it("dismisses one entry so it does not come back", async () => {
    const task = fakeTask("Water plants", {
      due_date: "2026-07-10T15:00:00Z",
      reminders: ["PT0S", "-PT1H"],
    });
    const api = installFakeApi({
      googleConfigured: false,
      reminderNotifications: true,
      tasks: [task],
      missedReminders: [fakeMissedReminder(task, "PT0S"), fakeMissedReminder(task, "-PT1H")],
    });
    installFakeNotifications({ permission: "granted" });
    render(<App />);

    const region = await screen.findByRole("region", { name: "Missed reminders" });
    const [first] = await within(region).findAllByRole("listitem");
    await userEvent.click(
      within(first!).getByRole("button", { name: "Dismiss missed reminder: Water plants" }),
    );

    await waitFor(() => expect(within(region).getAllByRole("listitem")).toHaveLength(1));
    expect(within(region).getByRole("listitem")).toHaveTextContent("1 hour before");
    expect(api.missedDismissals).toEqual([
      { task_id: task.id, offset: "PT0S", occurrence_due: "2026-07-10T15:00:00Z" },
    ]);

    const fetchesSoFar = missedRequests(api);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(missedRequests(api)).toBeGreaterThan(fetchesSoFar));
    expect(within(region).getAllByRole("listitem")).toHaveLength(1);
  });

  it("snoozes a missed reminder no tab ever claimed, leaving the Task as it was", async () => {
    const task = fakeTask("Water plants", {
      due_date: "2026-07-10T15:00:00Z",
      reminders: ["PT0S"],
    });
    const api = installFakeApi({
      googleConfigured: false,
      reminderNotifications: true,
      tasks: [task],
      missedReminders: [fakeMissedReminder(task, "PT0S")],
    });
    installFakeNotifications({ permission: "granted" });
    render(<App />);

    const region = await screen.findByRole("region", { name: "Missed reminders" });
    const entry = within(region).getByRole("listitem");
    expect(entry).toHaveTextContent(
      "Snoozing delays only this alert. The deadline stays unchanged.",
    );
    await userEvent.click(within(entry).getByRole("button", { name: "Snooze 10 minutes" }));

    expect(await within(entry).findByRole("status")).toHaveTextContent(
      /Snoozed until \d\d:\d\d\. Deadline unchanged\./,
    );
    expect(api.missedSnoozes).toEqual([
      { task_id: task.id, offset: "PT0S", occurrence_due: "2026-07-10T15:00:00Z", minutes: 10 },
    ]);
    expect(api.reminderSnoozes).toEqual([]);
    expect(api.tasks.find((t) => t.id === task.id)?.due_date).toBe("2026-07-10T15:00:00Z");
  });

  it("snoozes a missed reminder with a ledger row through the ordinary snooze", async () => {
    const task = fakeTask("Water plants", {
      due_date: "2026-07-10T15:00:00Z",
      reminders: ["PT0S"],
    });
    const api = installFakeApi({
      googleConfigured: false,
      reminderNotifications: true,
      tasks: [task],
      missedReminders: [fakeMissedReminder(task, "PT0S", { delivery_id: 41 })],
    });
    installFakeNotifications({ permission: "granted" });
    render(<App />);

    const region = await screen.findByRole("region", { name: "Missed reminders" });
    await userEvent.click(within(region).getByRole("button", { name: "Snooze 1 hour" }));

    expect(await within(region).findByRole("status")).toHaveTextContent(/Deadline unchanged/);
    expect(api.reminderSnoozes).toEqual([{ id: 41, minutes: 60 }]);
    expect(api.missedSnoozes).toEqual([]);
  });

  it("drops the list once its last entry is dismissed", async () => {
    const task = fakeTask("Water plants", {
      due_date: "2026-07-10T15:00:00Z",
      reminders: ["PT0S"],
    });
    installFakeApi({
      googleConfigured: false,
      reminderNotifications: true,
      tasks: [task],
      missedReminders: [fakeMissedReminder(task, "PT0S")],
    });
    installFakeNotifications({ permission: "granted" });
    render(<App />);

    const region = await screen.findByRole("region", { name: "Missed reminders" });
    await userEvent.click(
      within(region).getByRole("button", { name: "Dismiss missed reminder: Water plants" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Missed reminders" })).not.toBeInTheDocument(),
    );
  });

  it("shows missed reminders even where this device cannot notify", async () => {
    const task = fakeTask("Call the dentist", {
      due_date: "2026-07-10T15:00:00Z",
      reminders: ["PT0S"],
    });
    installFakeApi({
      googleConfigured: false,
      reminderNotifications: true,
      tasks: [task],
      missedReminders: [fakeMissedReminder(task, "PT0S")],
    });
    installFakeNotifications({ permission: "denied" });
    render(<App />);

    const region = await screen.findByRole("region", { name: "Missed reminders" });
    expect(within(region).getByRole("listitem")).toHaveTextContent("Call the dentist");
  });

  it("asks for nothing while Reminder notifications are off", async () => {
    const task = fakeTask("Call the dentist", {
      due_date: "2026-07-10T15:00:00Z",
      reminders: ["PT0S"],
    });
    const api = installFakeApi({
      googleConfigured: false,
      tasks: [task],
      missedReminders: [fakeMissedReminder(task, "PT0S")],
    });
    installFakeNotifications({ permission: "granted" });
    render(<App />);

    await screen.findByRole("button", { name: "Quick add" });
    expect(missedRequests(api)).toBe(0);
    expect(screen.queryByRole("region", { name: "Missed reminders" })).not.toBeInTheDocument();
  });
});
