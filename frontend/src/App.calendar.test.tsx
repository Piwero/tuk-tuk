import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeTask, installFakeApi, type RecordedRequest } from "./test/fakeApi";

// All tests pin the clock to Friday 2026-07-03, local noon, so "today" and
// every view window is deterministic in any timezone. (The suite runs in UTC,
// so local wall-clock times equal the stored UTC instants.)
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

async function openCalendar(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "Calendar" }));
  await screen.findByRole("heading", { name: "July 2026" });
}

const taskPosts = (requests: RecordedRequest[]): unknown[] =>
  requests.filter((r) => r.method === "POST" && r.url === "/api/v1/tasks").map((r) => r.body);

describe("The Month view", () => {
  it("fetches the visible grid and renders banners and timed entries", async () => {
    const api = installFakeApi({
      tasks: [
        // Starts before the July grid (Mon Jun 29): the window edge case.
        fakeTask("Offsite", {
          start_date: "2026-06-27T00:00:00Z",
          due_date: "2026-07-01T00:00:00Z",
          is_all_day: true,
        }),
        fakeTask("Standup", {
          start_date: "2026-07-06T09:00:00Z",
          due_date: "2026-07-06T09:30:00Z",
          time_zone: "UTC",
        }),
        fakeTask("Someday"),
      ],
    });
    render(<App />);

    await openCalendar();

    // The July grid runs Mon Jun 29 – Sun Aug 2.
    await waitFor(() =>
      expect(
        api.requests.some(
          (r) =>
            r.method === "GET" &&
            r.url ===
              "/api/v1/tasks?range_start=2026-06-29&range_end=2026-08-02&completed=false&limit=200",
        ),
      ).toBe(true),
    );
    // The banner covers only its on-grid days: Jun 29, 30, Jul 1.
    expect(await screen.findAllByText("Offsite")).toHaveLength(3);
    expect(within(screen.getByLabelText("2026-06-29")).getByText("Offsite")).toBeInTheDocument();
    expect(within(screen.getByLabelText("2026-07-01")).getByText("Offsite")).toBeInTheDocument();
    const standupDay = screen.getByLabelText("2026-07-06");
    expect(within(standupDay).getByText("Standup")).toBeInTheDocument();
    expect(within(standupDay).getByText("09:00")).toBeInTheDocument();
    expect(screen.queryByText("Someday")).not.toBeInTheDocument();
  });

  it("navigates previous / next / today", async () => {
    const api = installFakeApi();
    render(<App />);
    await openCalendar();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("heading", { name: "August 2026" });
    await waitFor(() =>
      expect(api.requests.some((r) => r.url.includes("range_start=2026-07-27"))).toBe(true),
    );

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await screen.findByRole("heading", { name: "July 2026" });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Go to today" }));
    await screen.findByRole("heading", { name: "July 2026" });
  });

  it("creates an all-day task from an empty cell", async () => {
    const api = installFakeApi();
    render(<App />);
    await openCalendar();

    // The whole empty cell is the click target, not just the + affordance.
    fireEvent.click(screen.getByLabelText("2026-07-15"));
    const input = await screen.findByRole("textbox", { name: "New task title" });
    fireEvent.change(input, { target: { value: "Dentist" } });
    fireEvent.submit(input);

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "Dentist",
      due_date: "2026-07-15T00:00:00Z",
      is_all_day: true,
      time_zone: "UTC",
    });
    // The refetched window now shows the new task in its cell.
    expect(
      await within(screen.getByLabelText("2026-07-15")).findByText("Dentist"),
    ).toBeInTheDocument();
  });

  it("places a timed task on the day read in its own timezone", async () => {
    // 03:00 UTC on Aug 1 is 23:00 on Jul 31 in New York: the backend files it
    // in the July window, so the grid must show it on Jul 31, at 23:00.
    installFakeApi({
      tasks: [
        fakeTask("Late night", {
          due_date: "2026-08-01T03:00:00Z",
          time_zone: "America/New_York",
        }),
      ],
    });
    render(<App />);

    await openCalendar();

    const cell = screen.getByLabelText("2026-07-31");
    expect(await within(cell).findByText("Late night")).toBeInTheDocument();
    expect(within(cell).getByText("23:00")).toBeInTheDocument();
  });
});

describe("The Week and Day views", () => {
  it("shows the week's time grid with an all-day lane and timed blocks", async () => {
    installFakeApi({
      tasks: [
        fakeTask("Conference", {
          start_date: "2026-06-30T00:00:00Z",
          due_date: "2026-07-02T00:00:00Z",
          is_all_day: true,
        }),
        fakeTask("Deep work", {
          start_date: "2026-07-03T10:00:00Z",
          due_date: "2026-07-03T11:30:00Z",
          time_zone: "UTC",
        }),
      ],
    });
    render(<App />);
    await openCalendar();

    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    await screen.findByRole("heading", { name: "Jun 29 – Jul 5, 2026" });

    const allDayLane = screen.getByLabelText("All day");
    expect(within(allDayLane).getByText("Conference")).toBeInTheDocument();
    const block = await screen.findByText("Deep work");
    expect(block.closest("[data-start='10:00']")).not.toBeNull();
    expect(screen.getByText("10:00–11:30")).toBeInTheDocument();
  });

  it("shows a single day with only that day's tasks", async () => {
    installFakeApi({
      tasks: [
        fakeTask("Today's block", {
          start_date: "2026-07-03T14:00:00Z",
          due_date: "2026-07-03T15:00:00Z",
          time_zone: "UTC",
        }),
        fakeTask("Tomorrow's block", {
          start_date: "2026-07-04T14:00:00Z",
          due_date: "2026-07-04T15:00:00Z",
          time_zone: "UTC",
        }),
      ],
    });
    render(<App />);
    await openCalendar();

    fireEvent.click(screen.getByRole("button", { name: "Day" }));
    await screen.findByRole("heading", { name: "Friday, July 3, 2026" });

    expect(await screen.findByText("Today's block")).toBeInTheDocument();
    expect(screen.queryByText("Tomorrow's block")).not.toBeInTheDocument();
  });

  it("creates a timed task by dragging across a time range", async () => {
    const api = installFakeApi();
    render(<App />);
    await openCalendar();

    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    await screen.findByRole("heading", { name: "Jun 29 – Jul 5, 2026" });

    fireEvent.mouseDown(screen.getByLabelText("2026-07-03 09:00"));
    fireEvent.mouseEnter(screen.getByLabelText("2026-07-03 10:00"));
    fireEvent.mouseUp(screen.getByLabelText("2026-07-03 10:00"));

    const input = await screen.findByRole("textbox", { name: "New task title" });
    fireEvent.change(input, { target: { value: "Design sync" } });
    fireEvent.submit(input);

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "Design sync",
      start_date: "2026-07-03T09:00:00.000Z",
      due_date: "2026-07-03T11:00:00.000Z",
      is_all_day: false,
      time_zone: "UTC",
    });
  });

  it("finishes the drag even when the mouse is released off the cells", async () => {
    installFakeApi();
    render(<App />);
    await openCalendar();

    fireEvent.click(screen.getByRole("button", { name: "Day" }));
    await screen.findByRole("heading", { name: "Friday, July 3, 2026" });

    fireEvent.mouseDown(screen.getByLabelText("2026-07-03 14:00"));
    // Released over the hour gutter, outside any hour cell.
    fireEvent.mouseUp(screen.getByText("14:00"));

    expect(await screen.findByRole("textbox", { name: "New task title" })).toBeInTheDocument();
  });
});
