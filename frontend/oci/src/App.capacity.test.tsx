import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { pinCalendarClock } from "./test/calendar";
import { fakeEvent, fakeTask, installFakeApi } from "./test/fakeApi";

// Friday 2026-07-03, local noon; the suite runs in UTC.
pinCalendarClock();

const WINDOW_ON = { enabled: true, start: "09:00", end: "17:00" };

async function openSettings(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "Account menu" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "My account" }));
}

async function openCalendarDay(): Promise<void> {
  fireEvent.click(await screen.findByRole("link", { name: "Calendar" }));
  await screen.findByRole("heading", { name: "Friday, July 3, 2026" }, { timeout: 10_000 });
}

describe("Capacity summary for a planning window (issue #563)", () => {
  it("explains available time, planned time with buffers, overlaps, all-day Events and unknown estimates", async () => {
    installFakeApi({
      googleConfigured: true,
      planningWindow: WINDOW_ON,
      events: [
        fakeEvent("Standup", {
          start_date: "2026-07-03T10:00:00Z",
          due_date: "2026-07-03T11:00:00Z",
        }),
        fakeEvent("Review", {
          start_date: "2026-07-03T10:30:00Z",
          due_date: "2026-07-03T11:30:00Z",
        }),
        fakeEvent("Offsite", {
          start_date: "2026-07-03T00:00:00Z",
          due_date: "2026-07-03T00:00:00Z",
          is_all_day: true,
        }),
      ],
      tasks: [
        // Due next week: its Planned work today still takes time today.
        fakeTask("Draft report", {
          due_date: "2026-07-10T00:00:00Z",
          is_all_day: true,
          planned_work: {
            start: "2026-07-03T13:00:00Z",
            duration_minutes: 60,
            time_zone: "UTC",
            buffer_minutes: 15,
            end: "2026-07-03T14:00:00Z",
          },
        }),
        fakeTask("Call the bank", { due_date: "2026-07-03T00:00:00Z", is_all_day: true }),
      ],
    });
    render(<App />);

    await openCalendarDay();

    const summary = await screen.findByRole("region", { name: "Capacity" });
    await waitFor(() =>
      expect(summary).toHaveTextContent("Planning window 09:00–17:00: 5h 15m available of 8h."),
    );
    expect(summary).toHaveTextContent("Events take 1h 30m.");
    expect(summary).toHaveTextContent("Planned work takes 1h 15m, buffers included.");
    expect(summary).toHaveTextContent("Overlapping time is counted once.");
    expect(summary).toHaveTextContent("All-day: Offsite. Not counted as busy time.");
    expect(summary).toHaveTextContent(
      "1 Task on this day has no estimate, so its time is unknown.",
    );
  });

  it("shows no summary while the planning window is off", async () => {
    installFakeApi({
      tasks: [fakeTask("Call the bank", { due_date: "2026-07-03T00:00:00Z", is_all_day: true })],
    });
    render(<App />);

    await openCalendarDay();
    await screen.findByText("Call the bank");

    expect(screen.queryByRole("region", { name: "Capacity" })).toBeNull();
  });

  it("lets the User choose the planning window in Settings", async () => {
    const api = installFakeApi({ googleConfigured: false });
    render(<App />);

    await openSettings();
    const section = await screen.findByRole("region", { name: "Planning window" });
    const toggle = within(section).getByLabelText("Planning window");
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);
    fireEvent.change(within(section).getByLabelText("Start"), { target: { value: "10:00" } });
    fireEvent.change(within(section).getByLabelText("End"), { target: { value: "15:30" } });

    await waitFor(() =>
      expect(api.planningWindow).toEqual({ enabled: true, start: "10:00", end: "15:30" }),
    );
  });

  it("keeps the planning window when Active hours change", async () => {
    const api = installFakeApi({
      googleConfigured: false,
      planningWindow: { enabled: true, start: "10:00", end: "15:00" },
    });
    render(<App />);

    await openSettings();
    const activeHours = await screen.findByRole("region", { name: "Active hours" });
    fireEvent.click(within(activeHours).getByLabelText("Active hours"));
    fireEvent.change(within(activeHours).getByLabelText("Start"), { target: { value: "07:00" } });

    await waitFor(() =>
      expect(api.activeHours).toEqual({ enabled: true, start: "07:00", end: "17:00" }),
    );
    expect(api.planningWindow).toEqual({ enabled: true, start: "10:00", end: "15:00" });
    const planning = screen.getByRole("region", { name: "Planning window" });
    expect(within(planning).getByLabelText("Start")).toHaveValue("10:00");
  });

  it("never asks for an estimate in Quick-Add", async () => {
    installFakeApi();
    render(<App />);
    fireEvent.click(await screen.findByRole("link", { name: "Inbox" }));

    fireEvent.click(
      within(screen.getByRole("complementary")).getByRole("button", { name: "Quick add" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Quick add" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Details" }));

    expect(within(dialog).queryByLabelText(/estimate|duration|planned work/i)).toBeNull();
    expect(within(dialog).queryByText(/estimate/i)).toBeNull();
  });
});
