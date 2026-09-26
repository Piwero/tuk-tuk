import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { openCalendar, openDay, openWeek, pinCalendarClock } from "./test/calendar";
import { closestOrThrow, fakeDataTransfer } from "./test/dnd";
import { fakeEvent, fakeTask, installFakeApi, type RecordedRequest } from "./test/fakeApi";

pinCalendarClock();

/** The undo window the Calendar's checkbox shares with every other surface. */
function tick(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

const patches = (requests: RecordedRequest[]): RecordedRequest[] =>
  requests.filter((r) => r.method === "PATCH" && r.url.startsWith("/api/v1/tasks/"));

const timedTask = (title: string) =>
  fakeTask(title, {
    start_date: "2026-07-03T14:00:00Z",
    due_date: "2026-07-03T15:00:00Z",
    time_zone: "UTC",
  });

describe("Completing a Task from the Calendar (Week/Day block)", () => {
  it("offers a checkbox on a Task block, deferred behind the same undo window", async () => {
    const api = installFakeApi({ tasks: [timedTask("Deep work")] });
    render(<App />);
    await openDay();

    const block = closestOrThrow(await screen.findByText("Deep work"), ".time-block");
    const checkbox = within(block).getByRole("checkbox", { name: "Complete Deep work" });
    fireEvent.click(checkbox);

    // Struck through and awaiting the window: nothing has been sent yet.
    expect(await screen.findByRole("status")).toHaveTextContent("Completed");
    expect(block).toHaveAttribute("data-completing", "true");
    expect(patches(api.requests)).toHaveLength(0);

    tick(5_000);

    await waitFor(() => expect(patches(api.requests)).toHaveLength(1));
    expect(patches(api.requests)[0]?.body).toMatchObject({ completed: true });
    // The Calendar shows plans, not history — a committed completion leaves.
    await waitFor(() => expect(screen.queryByText("Deep work")).toBeNull());
  });

  it("undo puts the block back and never sends the PATCH", async () => {
    const api = installFakeApi({ tasks: [timedTask("Deep work")] });
    render(<App />);
    await openDay();

    const block = closestOrThrow(await screen.findByText("Deep work"), ".time-block");
    fireEvent.click(within(block).getByRole("checkbox", { name: "Complete Deep work" }));

    const toast = await screen.findByRole("status");
    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));

    tick(10_000);
    expect(patches(api.requests)).toHaveLength(0);
    const restored = closestOrThrow(screen.getByText("Deep work"), ".time-block");
    expect(restored).not.toHaveAttribute("data-completing");
    expect(
      within(restored).getByRole("checkbox", { name: "Complete Deep work" }),
    ).not.toBeChecked();
  });

  it("ticking the checkbox does not open the Task detail panel", async () => {
    installFakeApi({ tasks: [timedTask("Deep work")] });
    render(<App />);
    await openDay();

    const block = closestOrThrow(await screen.findByText("Deep work"), ".time-block");
    fireEvent.click(within(block).getByRole("checkbox", { name: "Complete Deep work" }));

    expect(screen.queryByLabelText("Task details")).toBeNull();
  });

  it("strikes the title through while the completion is pending", async () => {
    installFakeApi({ tasks: [timedTask("Deep work")] });
    render(<App />);
    await openDay();

    const title = await screen.findByText("Deep work");
    expect(title).not.toHaveClass("completed");

    const block = closestOrThrow(title, ".time-block");
    fireEvent.click(within(block).getByRole("checkbox", { name: "Complete Deep work" }));

    // The app's one `.completed` class, not a calendar-specific copy.
    expect(screen.getByText("Deep work")).toHaveClass("completed");
  });

  it("does not reschedule the Task when the press that ticks it lands on the checkbox", async () => {
    // Every Task-backed entry is a draggable parent, so a drag starting on
    // the checkbox would otherwise pick the block up and drop it elsewhere.
    const api = installFakeApi({ tasks: [timedTask("Deep work")] });
    render(<App />);
    await openDay();

    const block = closestOrThrow(await screen.findByText("Deep work"), ".time-block");
    const dataTransfer = fakeDataTransfer();
    const checkbox = within(block).getByRole("checkbox", { name: "Complete Deep work" });
    fireEvent.dragStart(checkbox, { dataTransfer });
    fireEvent.drop(screen.getByLabelText("2026-07-03 08:00"), { dataTransfer });

    tick(5_000);
    expect(api.tasks.find((task) => task.title === "Deep work")).toMatchObject({
      start_date: "2026-07-03T14:00:00Z",
    });
  });

  it("leaves a recurring Task on the Calendar, advanced rather than removed", async () => {
    const api = installFakeApi({
      tasks: [
        fakeTask("Standup", {
          start_date: "2026-07-03T09:00:00Z",
          due_date: "2026-07-03T09:30:00Z",
          time_zone: "UTC",
          recurrence: "FREQ=DAILY",
        }),
      ],
    });
    render(<App />);
    await openWeek();

    const block = closestOrThrow(await screen.findByText("Standup"), ".time-block");
    fireEvent.click(within(block).getByRole("checkbox", { name: "Complete Standup" }));
    tick(5_000);

    await waitFor(() => expect(patches(api.requests)).toHaveLength(1));
    // Still open, so still on the grid — on its next occurrence's day.
    expect(
      closestOrThrow(screen.getByText("Standup"), ".day-column").getAttribute("data-day"),
    ).toBe("2026-07-04");
  });
});

describe("Completing an all-day Task from the Week/Day all-day lane", () => {
  it("offers a checkbox on a lane banner without opening that day's draft", async () => {
    const api = installFakeApi({
      tasks: [
        fakeTask("Offsite", {
          start_date: "2026-07-03T00:00:00Z",
          due_date: "2026-07-03T00:00:00Z",
          is_all_day: true,
        }),
      ],
    });
    render(<App />);
    await openDay();

    const lane = screen.getByLabelText("All day");
    const banner = closestOrThrow(await within(lane).findByText("Offsite"), ".calendar-banner");
    fireEvent.click(within(banner).getByRole("checkbox", { name: "Complete Offsite" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText("Task details")).toBeNull();
    expect(banner).toHaveAttribute("data-completing", "true");

    tick(5_000);
    await waitFor(() => expect(patches(api.requests)).toHaveLength(1));
    await waitFor(() => expect(within(lane).queryByText("Offsite")).toBeNull());
  });
});

describe("Completing a Task from the Month grid", () => {
  it("offers a checkbox on an all-day banner without opening the day's draft", async () => {
    const api = installFakeApi({
      tasks: [
        fakeTask("Offsite", {
          start_date: "2026-07-06T00:00:00Z",
          due_date: "2026-07-06T00:00:00Z",
          is_all_day: true,
        }),
      ],
    });
    render(<App />);
    await openCalendar();

    const cell = screen.getByLabelText("2026-07-06");
    const banner = closestOrThrow(await within(cell).findByText("Offsite"), ".calendar-banner");
    fireEvent.click(within(banner).getByRole("checkbox", { name: "Complete Offsite" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText("Task details")).toBeNull();
    tick(5_000);
    await waitFor(() => expect(patches(api.requests)).toHaveLength(1));
  });

  it("offers a checkbox on a timed Month entry", async () => {
    const api = installFakeApi({
      tasks: [
        fakeTask("Standup", {
          start_date: "2026-07-06T09:00:00Z",
          due_date: "2026-07-06T09:30:00Z",
          time_zone: "UTC",
        }),
      ],
    });
    render(<App />);
    await openCalendar();

    const cell = screen.getByLabelText("2026-07-06");
    const entry = closestOrThrow(await within(cell).findByText("Standup"), ".calendar-timed-entry");
    fireEvent.click(within(entry).getByRole("checkbox", { name: "Complete Standup" }));
    tick(5_000);

    await waitFor(() => expect(patches(api.requests)).toHaveLength(1));
  });
});

describe("Completing a Task from the Unscheduled rail", () => {
  it("offers a checkbox on a rail card and drops it once committed", async () => {
    const api = installFakeApi({ tasks: [fakeTask("Wash car")] });
    render(<App />);
    await openDay();

    const panel = await screen.findByRole("complementary", { name: "Unscheduled" });
    fireEvent.click(within(panel).getByRole("checkbox", { name: "Complete Wash car" }));
    tick(5_000);

    await waitFor(() => expect(patches(api.requests)).toHaveLength(1));
    await waitFor(() => expect(within(panel).queryByText("Wash car")).toBeNull());
  });

  it("undo from the rail keeps the card, same as from a block", async () => {
    // The whole point of routing every surface through useTaskCompletion: a
    // second surface must not commit where the first one defers.
    const api = installFakeApi({ tasks: [fakeTask("Wash car")] });
    render(<App />);
    await openDay();

    const panel = await screen.findByRole("complementary", { name: "Unscheduled" });
    fireEvent.click(within(panel).getByRole("checkbox", { name: "Complete Wash car" }));
    const toast = await screen.findByRole("status");
    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));

    tick(10_000);
    expect(patches(api.requests)).toHaveLength(0);
    expect(within(panel).getByText("Wash car")).toBeInTheDocument();
  });
});

describe("Events on the Calendar stay uncompletable", () => {
  it("renders no completion checkbox on an Event block", async () => {
    installFakeApi({
      events: [
        fakeEvent("Board meeting", {
          start_date: "2026-07-03T14:00:00Z",
          due_date: "2026-07-03T15:00:00Z",
        }),
      ],
    });
    render(<App />);
    await openDay();

    const block = closestOrThrow(await screen.findByText("Board meeting"), ".time-block");
    expect(within(block).queryByRole("checkbox")).toBeNull();
  });

  it("renders no completion checkbox on an all-day Event banner", async () => {
    installFakeApi({
      events: [
        fakeEvent("Public holiday", {
          start_date: "2026-07-03T00:00:00Z",
          due_date: "2026-07-03T00:00:00Z",
          is_all_day: true,
        }),
      ],
    });
    render(<App />);
    await openDay();

    const banner = closestOrThrow(await screen.findByText("Public holiday"), ".calendar-banner");
    expect(within(banner).queryByRole("checkbox")).toBeNull();
  });
});
