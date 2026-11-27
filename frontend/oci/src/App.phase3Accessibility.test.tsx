import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { openDay, pinCalendarClock } from "./test/calendar";
import { fakeHeldReminder, fakeTask, installFakeApi } from "./test/fakeApi";
import { installFakeNotifications } from "./test/fakeNotifications";

// Phase 3 accessibility checks (#569): what a screen reader or keyboard user
// observes on the surfaces #557–#568 added. Visual checks (hit areas, focus
// ring, phone layout) are CSS-source guards in tapTargetGuard.test.ts; real
// browser results are in docs/design/adhd-phase-3/release-check.md.

pinCalendarClock();
afterEach(() => vi.unstubAllGlobals());

function plan(start: string, durationMinutes: number) {
  const end = new Date(new Date(start).getTime() + durationMinutes * 60_000);
  return {
    start,
    duration_minutes: durationMinutes,
    time_zone: "UTC",
    buffer_minutes: null,
    end: `${end.toISOString().slice(0, 19)}Z`,
  };
}

describe("Capacity summary", () => {
  it("announces a changed summary politely", async () => {
    installFakeApi({
      planningWindow: { enabled: true, start: "09:00", end: "17:00" },
      tasks: [fakeTask("Call the bank", { due_date: "2026-07-03T00:00:00Z", is_all_day: true })],
    });
    render(<App />);
    await openDay();

    const summary = await screen.findByRole("region", { name: "Capacity" });
    expect(summary).toHaveAttribute("aria-live", "polite");
  });
});

describe("Quiet hours deferred", () => {
  it("is announced through a live region already on the page before Reminders are held", async () => {
    const task = fakeTask("Call the dentist", {
      due_date: "2026-07-03T23:00:00Z",
      reminders: ["PT0S"],
    });
    const api = installFakeApi({
      googleConfigured: false,
      reminderNotifications: true,
      tasks: [task],
    });
    installFakeNotifications({ permission: "granted" });
    render(<App />);
    await waitFor(() =>
      expect(api.requests.some((r) => r.url.includes("/reminder-deliveries/claim"))).toBe(true),
    );
    const live = document.querySelector('[aria-live="polite"].reminder-panels');
    expect(live).not.toBeNull();

    api.heldReminders = [fakeHeldReminder(task, "PT0S")];
    api.quietUntil = "2026-07-04T07:00:00Z";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    const deferred = await screen.findByRole("region", { name: "Quiet hours deferred" });
    expect(live).toContainElement(deferred);
  });

  it("comes after the page in tab order, not before the sidebar", async () => {
    const task = fakeTask("Call the dentist", {
      due_date: "2026-07-03T23:00:00Z",
      reminders: ["PT0S"],
    });
    installFakeApi({
      googleConfigured: false,
      reminderNotifications: true,
      tasks: [task],
      heldReminders: [fakeHeldReminder(task, "PT0S")],
      quietUntil: "2026-07-04T07:00:00Z",
    });
    installFakeNotifications({ permission: "granted" });
    render(<App />);

    const deferred = await screen.findByRole("region", { name: "Quiet hours deferred" });
    const main = screen.getByRole("main");
    const nav = screen.getAllByRole("navigation")[0]!;
    expect(main.compareDocumentPosition(deferred) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nav.compareDocumentPosition(deferred) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("Release gate: unsupported delivery is unmistakable", () => {
  it("says beside inline Quick-Add reminder chips that they are not notifications", async () => {
    installFakeApi({
      assistAvailable: true,
      assistParseResult: {
        title: "dentist",
        due_date: "2026-08-18T15:00:00-04:00",
        is_all_day: false,
        time_zone: "America/New_York",
        recurrence: null,
        reminders: ["-P1D"],
        list_name: null,
        tag_names: [],
        priority: null,
      },
    });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("link", { name: "Inbox" }));
    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await screen.findByLabelText("Assist available");
    await user.type(input, "dentist tuesday 3pm remind me the day before{Enter}");

    const draft = await screen.findByRole("group", { name: "Assisted Capture draft" });
    expect(within(draft).getByText(/^Not notifications/)).toBeInTheDocument();
  });
});

describe("Quiet hours setting", () => {
  it("ties the same-time error to both time fields", async () => {
    installFakeApi({
      googleConfigured: false,
      quietHours: { enabled: true, start: "22:00", end: "07:00" },
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("menuitem", { name: "My account" }));
    const section = await screen.findByRole("region", { name: "Quiet hours" });

    await user.selectOptions(within(section).getByLabelText("Quiet until"), "22:00");

    const message = "Quiet hours must start and end at different times.";
    expect(within(section).getByLabelText("Quiet from")).toHaveAccessibleDescription(message);
    expect(within(section).getByLabelText("Quiet until")).toHaveAccessibleDescription(message);
    expect(within(section).getByLabelText("Quiet until")).toBeInvalid();
  });
});

describe("Planned work", () => {
  it("can be opened from the Calendar with the keyboard, not only by clicking the block", async () => {
    installFakeApi({
      tasks: [
        fakeTask("Write report", {
          due_date: "2026-07-20T18:00:00Z",
          time_zone: "UTC",
          planned_work: plan("2026-07-03T10:00:00Z", 60),
        }),
      ],
    });
    const user = userEvent.setup();
    render(<App />);
    await openDay();

    const block = await screen.findByRole("group", { name: "Planned work: Write report" });
    const open = within(block).getByRole("button", { name: "Open planned work: Write report" });
    open.focus();
    await user.keyboard("{Enter}");

    const panel = await screen.findByRole("complementary", { name: "Task details" });
    expect(within(panel).getByRole("button", { name: /^Planned work / })).toBeInTheDocument();
  });

  it("ties a refused save's error to the plan's fields", async () => {
    installFakeApi({
      tasks: [
        fakeTask("Write report", {
          due_date: "2026-07-20T18:00:00Z",
          time_zone: "UTC",
          planned_work: plan("2026-07-03T10:00:00Z", 60),
        }),
      ],
    });
    render(<App />);
    await openDay();

    fireEvent.click(await screen.findByRole("group", { name: "Planned work: Write report" }));
    const panel = await screen.findByRole("complementary", { name: "Task details" });
    fireEvent.click(within(panel).getByRole("button", { name: /^Planned work / }));
    const dialog = within(panel).getByRole("dialog", { name: "Planned work" });
    fireEvent.change(within(dialog).getByLabelText("Start"), { target: { value: "23:30" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save plan" }));

    const alert = await within(dialog).findByRole("alert");
    for (const label of ["Day", "Start", "Duration (minutes)", "Buffer after (minutes)"]) {
      expect(within(dialog).getByLabelText(label)).toHaveAccessibleDescription(
        alert.textContent ?? "",
      );
    }
  });
});
