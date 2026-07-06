import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { openCalendar, openWeek, pinCalendarClock } from "./test/calendar";
import { fakeTask, installFakeApi, type RecordedRequest } from "./test/fakeApi";

pinCalendarClock();

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
    // Undated: listed once, in the unscheduled panel — never on the grid.
    expect(
      within(screen.getByRole("complementary", { name: "Unscheduled" })).getByText("Someday"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Someday")).toHaveLength(1);
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
  it("shows the day's time grid with an all-day lane and timed blocks", async () => {
    installFakeApi({
      tasks: [
        fakeTask("Conference", {
          start_date: "2026-07-03T00:00:00Z",
          due_date: "2026-07-03T00:00:00Z",
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

    fireEvent.click(screen.getByRole("button", { name: "Day" }));
    await screen.findByRole("heading", { name: "Friday, July 3, 2026" });

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

  it("creates a timed task by dragging across a time range in day view", async () => {
    const api = installFakeApi();
    render(<App />);
    await openCalendar();

    fireEvent.click(screen.getByRole("button", { name: "Day" }));
    await screen.findByRole("heading", { name: "Friday, July 3, 2026" });

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

  it("caps a drag through the last hour cell at 23:59, within the day", async () => {
    const api = installFakeApi();
    render(<App />);
    await openCalendar();

    fireEvent.click(screen.getByRole("button", { name: "Day" }));
    await screen.findByRole("heading", { name: "Friday, July 3, 2026" });

    fireEvent.mouseDown(screen.getByLabelText("2026-07-03 23:00"));
    fireEvent.mouseUp(screen.getByLabelText("2026-07-03 23:00"));
    const input = await screen.findByRole("textbox", { name: "New task title" });
    fireEvent.change(input, { target: { value: "Night owl" } });
    fireEvent.submit(input);

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toMatchObject({
      start_date: "2026-07-03T23:00:00.000Z",
      due_date: "2026-07-03T23:59:00.000Z",
    });
  });
});

describe("The Week view", () => {
  it("displays 5 day columns starting from today with dynamic day names", async () => {
    const api = installFakeApi({
      tasks: [
        fakeTask("Friday standup", {
          start_date: "2026-07-03T10:00:00Z",
          due_date: "2026-07-03T10:30:00Z",
          time_zone: "UTC",
        }),
        fakeTask("Weekend plan"),
      ],
    });
    render(<App />);

    await openWeek();

    // Verify heading shows correct date range (today + 4 days, not always Mon-Fri)
    expect(screen.getByRole("heading", { name: "Jul 3 – Jul 7, 2026" })).toBeInTheDocument();

    // Verify API fetches the correct 5-day range starting from today
    await waitFor(() =>
      expect(
        api.requests.some(
          (r) =>
            r.method === "GET" &&
            r.url ===
              "/api/v1/tasks?range_start=2026-07-03&range_end=2026-07-07&completed=false&limit=200",
        ),
      ).toBe(true),
    );

    // Verify all 5 day columns are rendered with correct day names (dynamic, not hardcoded)
    // Today is Friday, so expect Fri, Sat, Sun, Mon, Tue
    expect(screen.getByText("Fri")).toBeInTheDocument();
    expect(screen.getByText("Sat")).toBeInTheDocument();
    expect(screen.getByText("Sun")).toBeInTheDocument();
    expect(screen.getByText("Mon")).toBeInTheDocument();
    expect(screen.getByText("Tue")).toBeInTheDocument();

    // Verify dates under day names (format: day/month)
    const dateElements = screen.getAllByText(/^\d+\/7$/); // July dates: 3/7, 4/7, etc.
    expect(dateElements).toHaveLength(5);

    // Verify the task is displayed (it may be in a card or list item)
    expect(await screen.findByText("Friday standup")).toBeInTheDocument();

    // Verify undated task appears in Unscheduled panel
    expect(
      within(screen.getByRole("complementary", { name: "Unscheduled" })).getByText("Weekend plan"),
    ).toBeInTheDocument();
  });

  it("displays task cards with time, icon, title, and duration", async () => {
    installFakeApi({
      tasks: [
        // 30-minute task
        fakeTask("Quick sync", {
          start_date: "2026-07-03T09:00:00Z",
          due_date: "2026-07-03T09:30:00Z",
          time_zone: "UTC",
        }),
        // 1-hour task
        fakeTask("Standup", {
          start_date: "2026-07-03T10:00:00Z",
          due_date: "2026-07-03T11:00:00Z",
          time_zone: "UTC",
        }),
        // 1.5-hour task
        fakeTask("Design review", {
          start_date: "2026-07-04T14:00:00Z",
          due_date: "2026-07-04T15:30:00Z",
          time_zone: "UTC",
        }),
      ],
    });
    render(<App />);

    await openWeek();

    // Verify task cards display start time
    expect(await screen.findByText("09:00")).toBeInTheDocument(); // Quick sync start
    expect(await screen.findByText("10:00")).toBeInTheDocument(); // Standup start
    expect(await screen.findByText("14:00")).toBeInTheDocument(); // Design review start

    // Verify task titles are visible
    expect(screen.getByText("Quick sync")).toBeInTheDocument();
    expect(screen.getByText("Standup")).toBeInTheDocument();
    expect(screen.getByText("Design review")).toBeInTheDocument();

    // Verify durations are correctly formatted
    expect(screen.getByText("30m")).toBeInTheDocument(); // 30 minutes
    expect(screen.getAllByText("1h")).toHaveLength(1); // 1 hour (Standup)
    expect(screen.getByText("1h 30m")).toBeInTheDocument(); // 1 hour 30 minutes
  });
});
