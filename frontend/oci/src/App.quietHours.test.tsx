import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeHeldReminder, fakeReminderClaim, fakeTask, installFakeApi } from "./test/fakeApi";
import { installFakeNotifications } from "./test/fakeNotifications";

// Quiet hours (issue #567): a notification setting of its own, separate
// from the Calendar's Active hours. Reminders due inside the band are held
// and notify once when it ends. Deferral, deduplication and timezone rules
// are proven by the backend's HTTP tests against PostgreSQL; this fake only
// plays the server's answers.

afterEach(() => vi.unstubAllGlobals());

type User = ReturnType<typeof userEvent.setup>;

async function openSettings(user: User): Promise<void> {
  await user.click(await screen.findByRole("button", { name: "Account menu" }));
  await user.click(screen.getByRole("menuitem", { name: "My account" }));
}

describe("Quiet hours setting", () => {
  it("is its own section, labelled as not Active hours, off with a night band", async () => {
    installFakeApi({ googleConfigured: false });
    const user = userEvent.setup();
    render(<App />);
    await openSettings(user);

    const section = await screen.findByRole("region", { name: "Quiet hours" });
    expect(within(section).getByRole("heading", { name: "Quiet hours" })).toBeVisible();
    expect(within(section).getByText(/not Active hours/)).toBeInTheDocument();
    expect(within(section).getByLabelText("Hold reminders during quiet hours")).not.toBeChecked();
    expect(within(section).getByLabelText("Quiet from")).toHaveValue("22:00");
    expect(within(section).getByLabelText("Quiet until")).toHaveValue("07:00");
    expect(within(section).getByText("Ends at 07:00 the next day.")).toBeInTheDocument();
    const activeHours = screen.getByRole("region", { name: "Active hours" });
    expect(within(activeHours).queryByText(/Quiet/)).not.toBeInTheDocument();
  });

  it("saves a band without touching Active hours", async () => {
    const api = installFakeApi({
      googleConfigured: false,
      activeHours: { enabled: true, start: "09:00", end: "17:00" },
    });
    const user = userEvent.setup();
    render(<App />);
    await openSettings(user);
    const section = await screen.findByRole("region", { name: "Quiet hours" });

    await user.click(within(section).getByLabelText("Hold reminders during quiet hours"));
    await user.selectOptions(within(section).getByLabelText("Quiet from"), "23:30");
    await user.selectOptions(within(section).getByLabelText("Quiet until"), "06:15");

    await waitFor(() =>
      expect(api.quietHours).toEqual({ enabled: true, start: "23:30", end: "06:15" }),
    );
    expect(api.activeHours).toEqual({ enabled: true, start: "09:00", end: "17:00" });
    expect(
      api.requests.filter((r) => r.method === "PUT" && r.url.endsWith("/settings/active-hours")),
    ).toHaveLength(0);
  });

  it("explains a band that starts and ends at the same time and does not save it", async () => {
    const api = installFakeApi({
      googleConfigured: false,
      quietHours: { enabled: true, start: "22:00", end: "07:00" },
    });
    const user = userEvent.setup();
    render(<App />);
    await openSettings(user);
    const section = await screen.findByRole("region", { name: "Quiet hours" });

    await user.selectOptions(within(section).getByLabelText("Quiet until"), "22:00");

    expect(await within(section).findByRole("alert")).toHaveTextContent(
      "Quiet hours must start and end at different times.",
    );
    expect(api.quietHours).toEqual({ enabled: true, start: "22:00", end: "07:00" });
  });

  it("shows the server's reason when it refuses a band", async () => {
    installFakeApi({
      googleConfigured: false,
      quietHoursError: "'25:00' is not a time of day",
    });
    const user = userEvent.setup();
    render(<App />);
    await openSettings(user);
    const section = await screen.findByRole("region", { name: "Quiet hours" });

    await user.click(within(section).getByLabelText("Hold reminders during quiet hours"));

    expect(await within(section).findByRole("alert")).toHaveTextContent(
      "Couldn’t save quiet hours: '25:00' is not a time of day",
    );
  });
});

describe("Quiet hours deferred", () => {
  it("lists held Reminders in-app while quiet hours are on, without notifying", async () => {
    const dentist = fakeTask("Call the dentist", {
      due_date: "2026-11-10T23:00:00Z",
      reminders: ["PT0S"],
    });
    const parcel = fakeTask("Pick up parcel", {
      due_date: "2026-11-11T02:00:00Z",
      reminders: ["-PT30M"],
    });
    installFakeApi({
      googleConfigured: false,
      reminderNotifications: true,
      tasks: [dentist, parcel],
      heldReminders: [fakeHeldReminder(dentist, "PT0S"), fakeHeldReminder(parcel, "-PT30M")],
      quietUntil: "2026-11-11T07:00:00Z",
    });
    const notifications = installFakeNotifications({ permission: "granted" });
    render(<App />);

    const held = await screen.findByRole("region", { name: "Quiet hours deferred" });
    expect(within(held).getByText(/2 reminders held until/)).toBeInTheDocument();
    expect(within(held).getByText("Call the dentist")).toBeInTheDocument();
    expect(within(held).getByText("Pick up parcel")).toBeInTheDocument();
    expect(within(held).getByText("30 minutes before")).toBeInTheDocument();
    expect(within(held).getByText(/They notify once when quiet hours end/)).toBeInTheDocument();
    expect(notifications.shown).toHaveLength(0);
  });

  it("clears the held list and notifies once quiet hours end", async () => {
    const task = fakeTask("Call the dentist", {
      due_date: "2026-11-10T23:00:00Z",
      reminders: ["PT0S"],
    });
    const api = installFakeApi({
      googleConfigured: false,
      reminderNotifications: true,
      tasks: [task],
      heldReminders: [fakeHeldReminder(task, "PT0S")],
      quietUntil: "2026-11-11T07:00:00Z",
    });
    const notifications = installFakeNotifications({ permission: "granted" });
    render(<App />);
    expect(await screen.findByRole("region", { name: "Quiet hours deferred" })).toBeVisible();

    api.heldReminders = [];
    api.quietUntil = null;
    api.reminderClaims.push(fakeReminderClaim(task, "PT0S"));
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(notifications.shown).toHaveLength(1));
    expect(screen.queryByRole("region", { name: "Quiet hours deferred" })).not.toBeInTheDocument();
  });

  it("shows nothing when no Reminder is held", async () => {
    installFakeApi({ googleConfigured: false, reminderNotifications: true });
    installFakeNotifications({ permission: "granted" });
    render(<App />);

    await screen.findByRole("button", { name: "Account menu" });
    expect(screen.queryByRole("region", { name: "Quiet hours deferred" })).not.toBeInTheDocument();
  });
});
