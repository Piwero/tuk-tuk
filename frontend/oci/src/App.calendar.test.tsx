import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { openCalendar, openWeek, pinCalendarClock } from "./test/calendar";
import { closestOrThrow } from "./test/dnd";
import { fakeTask, fakeTimer, installFakeApi, type RecordedRequest } from "./test/fakeApi";

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

  it("marks today's cell as visually distinct, unlike every other cell", async () => {
    installFakeApi();
    render(<App />);
    await openCalendar();

    // Today (per pinCalendarClock) is Friday 2026-07-03.
    expect(screen.getByLabelText("2026-07-03")).toHaveAttribute("data-today");
    // No other in-month cell carries the marker…
    expect(screen.getByLabelText("2026-07-02")).not.toHaveAttribute("data-today");
    expect(screen.getByLabelText("2026-07-15")).not.toHaveAttribute("data-today");
    // …nor does an adjacent-month (leading grid) cell.
    const outsideCell = screen.getByLabelText("2026-06-29");
    expect(outsideCell).toHaveAttribute("data-outside");
    expect(outsideCell).not.toHaveAttribute("data-today");
  });

  it("creates an all-day task from an empty cell", async () => {
    const api = installFakeApi();
    render(<App />);
    await openCalendar();

    // The whole empty cell is the click target, not just the + affordance.
    fireEvent.click(screen.getByLabelText("2026-07-15"));
    const input = await screen.findByRole("combobox", { name: "New task title" });
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

  it("opens the new-task draft as a popup dialog, not an inline row", async () => {
    installFakeApi();
    render(<App />);
    await openCalendar();

    fireEvent.click(screen.getByLabelText("2026-07-15"));
    const dialog = await screen.findByRole("dialog", {
      name: "New task on Wednesday, July 15, 2026",
    });
    expect(within(dialog).getByRole("combobox", { name: "New task title" })).toBeInTheDocument();
  });

  it("lets an all-day draft's timeframe be edited before it's created", async () => {
    const api = installFakeApi();
    render(<App />);
    await openCalendar();

    fireEvent.click(screen.getByLabelText("2026-07-15"));
    const input = await screen.findByRole("combobox", { name: "New task title" });
    fireEvent.change(input, { target: { value: "Dentist" } });

    fireEvent.click(screen.getByRole("checkbox", { name: "All day" }));
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "13:30" } });
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "14:00" } });
    fireEvent.submit(input);

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "Dentist",
      start_date: "2026-07-15T13:30:00.000Z",
      due_date: "2026-07-15T14:00:00.000Z",
      is_all_day: false,
      time_zone: "UTC",
    });
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

    const input = await screen.findByRole("combobox", { name: "New task title" });
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

  it("lets a dragged draft's start/end time be edited before it's created", async () => {
    const api = installFakeApi();
    render(<App />);
    await openCalendar();

    fireEvent.click(screen.getByRole("button", { name: "Day" }));
    await screen.findByRole("heading", { name: "Friday, July 3, 2026" });

    fireEvent.mouseDown(screen.getByLabelText("2026-07-03 09:00"));
    fireEvent.mouseEnter(screen.getByLabelText("2026-07-03 10:00"));
    fireEvent.mouseUp(screen.getByLabelText("2026-07-03 10:00"));

    const input = await screen.findByRole("combobox", { name: "New task title" });
    fireEvent.change(input, { target: { value: "Design sync" } });
    // The drag proposed 09:00–11:00; the popup lets that be corrected.
    fireEvent.change(screen.getByLabelText("End time"), { target: { value: "10:30" } });
    fireEvent.submit(input);

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "Design sync",
      start_date: "2026-07-03T09:00:00.000Z",
      due_date: "2026-07-03T10:30:00.000Z",
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

    expect(await screen.findByRole("combobox", { name: "New task title" })).toBeInTheDocument();
  });

  it("caps a drag through the last hour cell at 23:59, within the day", async () => {
    const api = installFakeApi();
    render(<App />);
    await openCalendar();

    fireEvent.click(screen.getByRole("button", { name: "Day" }));
    await screen.findByRole("heading", { name: "Friday, July 3, 2026" });

    fireEvent.mouseDown(screen.getByLabelText("2026-07-03 23:00"));
    fireEvent.mouseUp(screen.getByLabelText("2026-07-03 23:00"));
    const input = await screen.findByRole("combobox", { name: "New task title" });
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
  it("displays 7 day columns for the Monday-aligned week, with dynamic day names", async () => {
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

    // Verify heading shows the Monday-aligned week containing today (Fri Jul
    // 3), not a rolling 5-day window starting on today.
    expect(screen.getByRole("heading", { name: "Jun 29 – Jul 5, 2026" })).toBeInTheDocument();

    // Verify API fetches the full 7-day week, Monday to Sunday.
    await waitFor(() =>
      expect(
        api.requests.some(
          (r) =>
            r.method === "GET" &&
            r.url ===
              "/api/v1/tasks?range_start=2026-06-29&range_end=2026-07-05&completed=false&limit=200",
        ),
      ).toBe(true),
    );

    // Verify all 7 day columns are rendered with correct day names (dynamic,
    // not hardcoded), Monday through Sunday — including Wed/Thu, which the
    // old 5-day rolling window anchored on a Friday would have dropped.
    expect(screen.getByText("Mon")).toBeInTheDocument();
    expect(screen.getByText("Tue")).toBeInTheDocument();
    expect(screen.getByText("Wed")).toBeInTheDocument();
    expect(screen.getByText("Thu")).toBeInTheDocument();
    expect(screen.getByText("Fri")).toBeInTheDocument();
    expect(screen.getByText("Sat")).toBeInTheDocument();
    expect(screen.getByText("Sun")).toBeInTheDocument();

    // Verify dates under day names: Jun 29 – Jul 5, seven columns total.
    const juneDates = screen.getAllByText(/^\d+\/6$/);
    const julyDates = screen.getAllByText(/^\d+\/7$/);
    expect(juneDates.length + julyDates.length).toBe(7);

    // Verify the task is displayed (it may be in a card or list item)
    expect(await screen.findByText("Friday standup")).toBeInTheDocument();

    // Verify undated task appears in Unscheduled panel
    expect(
      within(screen.getByRole("complementary", { name: "Unscheduled" })).getByText("Weekend plan"),
    ).toBeInTheDocument();
  });

  it("steps to the previous/next week and stays on the Monday boundary", async () => {
    const api = installFakeApi();
    render(<App />);

    await openWeek();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("heading", { name: "Jul 6 – Jul 12, 2026" });
    await waitFor(() =>
      expect(api.requests.some((r) => r.url.includes("range_start=2026-07-06"))).toBe(true),
    );

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await screen.findByRole("heading", { name: "Jun 29 – Jul 5, 2026" });

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await screen.findByRole("heading", { name: "Jun 22 – Jun 28, 2026" });
  });

  it("lays timed blocks out in their day columns, sized by their times", async () => {
    installFakeApi({
      tasks: [
        fakeTask("Quick sync", {
          start_date: "2026-07-03T09:00:00Z",
          due_date: "2026-07-03T09:30:00Z",
          time_zone: "UTC",
        }),
        fakeTask("Standup", {
          start_date: "2026-07-03T10:00:00Z",
          due_date: "2026-07-03T11:00:00Z",
          time_zone: "UTC",
        }),
        fakeTask("Design review", {
          start_date: "2026-07-04T14:00:00Z",
          due_date: "2026-07-04T15:30:00Z",
          time_zone: "UTC",
        }),
      ],
    });
    render(<App />);

    await openWeek();

    // Each task renders as a time block in its own day's column…
    const quickSync = closestOrThrow(await screen.findByText("Quick sync"), ".time-block");
    expect(quickSync).toHaveAttribute("data-start", "09:00");
    expect(quickSync.closest("[data-day]")).toHaveAttribute("data-day", "2026-07-03");
    const review = closestOrThrow(screen.getByText("Design review"), ".time-block");
    expect(review.closest("[data-day]")).toHaveAttribute("data-day", "2026-07-04");

    // …labelled with its full time range.
    expect(screen.getByText("09:00–09:30")).toBeInTheDocument();
    expect(screen.getByText("10:00–11:00")).toBeInTheDocument();
    expect(screen.getByText("14:00–15:30")).toBeInTheDocument();
  });

  it("creates a timed task by dragging across hours in a week column", async () => {
    const api = installFakeApi();
    render(<App />);

    await openWeek();

    fireEvent.mouseDown(screen.getByLabelText("2026-07-04 09:00"));
    fireEvent.mouseEnter(screen.getByLabelText("2026-07-04 10:00"));
    fireEvent.mouseUp(screen.getByLabelText("2026-07-04 10:00"));

    const input = await screen.findByRole("combobox", { name: "New task title" });
    fireEvent.change(input, { target: { value: "Weekend prep" } });
    fireEvent.submit(input);

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "Weekend prep",
      start_date: "2026-07-04T09:00:00.000Z",
      due_date: "2026-07-04T11:00:00.000Z",
      is_all_day: false,
      time_zone: "UTC",
    });
  });

  it("resizes a block by dragging its bottom edge in the week grid", async () => {
    const api = installFakeApi({
      tasks: [
        fakeTask("Standup", {
          start_date: "2026-07-03T10:00:00Z",
          due_date: "2026-07-03T10:30:00Z",
          time_zone: "UTC",
        }),
      ],
    });
    render(<App />);

    await openWeek();

    fireEvent.mouseDown(await screen.findByLabelText('Resize end of "Standup"'), {
      clientY: 400,
    });
    fireEvent.mouseMove(window, { clientY: 418 }); // +30 minutes at 36px per hour
    fireEvent.mouseUp(window);

    await waitFor(() =>
      expect(api.tasks.find((task) => task.title === "Standup")).toMatchObject({
        start_date: "2026-07-03T10:00:00Z",
        due_date: "2026-07-03T11:00:00.000Z",
      }),
    );
  });
});

describe("Pomo quick-start menu on Calendar Task entries", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0));
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("right-click on a month-view Task entry opens PomoQuickStartMenu", async () => {
    const task = fakeTask("Dentist", {
      start_date: "2026-07-15T00:00:00Z",
      due_date: "2026-07-15T00:00:00Z",
      is_all_day: true,
    });
    installFakeApi({
      tasks: [task],
      timers: [fakeTimer("Deep Work 50", { duration_seconds: 3000 })],
    });
    render(<App />);

    await openCalendar();
    const monthCell = screen.getByLabelText("2026-07-15");
    const taskElement = within(monthCell).getByText("Dentist").closest("div");

    fireEvent.contextMenu(taskElement as HTMLElement);

    const menu = await screen.findByRole("menu", { name: "Start Focus for Dentist" });
    expect(within(menu).getByRole("menuitem", { name: "Deep Work 50" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Custom…" })).toBeInTheDocument();
  });

  it("right-click on an all-day Task in week view opens PomoQuickStartMenu", async () => {
    // Wed Jul 1: inside the Monday-aligned week (Jun 29 – Jul 5) containing today.
    const task = fakeTask("Team Lunch", {
      start_date: "2026-07-01T00:00:00Z",
      due_date: "2026-07-01T00:00:00Z",
      is_all_day: true,
    });
    installFakeApi({
      tasks: [task],
      timers: [fakeTimer("Deep Work 50", { duration_seconds: 3000 })],
    });
    render(<App />);

    await openCalendar();
    await openWeek();

    const taskElement = screen.getByText("Team Lunch").closest("div");
    fireEvent.contextMenu(taskElement as HTMLElement);

    const menu = await screen.findByRole("menu", { name: "Start Focus for Team Lunch" });
    expect(within(menu).getByRole("menuitem", { name: "Deep Work 50" })).toBeInTheDocument();
  });

  it("right-click on a timed Task block in week view opens PomoQuickStartMenu", async () => {
    // Wed Jul 1: inside the Monday-aligned week (Jun 29 – Jul 5) containing today.
    const task = fakeTask("Standup", {
      start_date: "2026-07-01T09:00:00Z",
      due_date: "2026-07-01T09:30:00Z",
      time_zone: "UTC",
    });
    installFakeApi({
      tasks: [task],
      timers: [fakeTimer("Deep Work 50", { duration_seconds: 3000 })],
    });
    render(<App />);

    await openCalendar();
    await openWeek();

    const taskElement = screen.getByText("Standup").closest("[class*='time-block']");
    fireEvent.contextMenu(taskElement as HTMLElement);

    const menu = await screen.findByRole("menu", { name: "Start Focus for Standup" });
    expect(within(menu).getByRole("menuitem", { name: "Deep Work 50" })).toBeInTheDocument();
  });

  it("Calendar entries open menu across all three Task views: month, week, day", async () => {
    // Wed Jul 1: inside both the July month grid and the Monday-aligned week
    // (Jun 29 – Jul 5) containing "today" (Fri Jul 3).
    const allDayTask = fakeTask("Team Sync", {
      start_date: "2026-07-01T00:00:00Z",
      due_date: "2026-07-01T00:00:00Z",
      is_all_day: true,
    });
    installFakeApi({
      tasks: [allDayTask],
      timers: [fakeTimer("Quick 15", { duration_seconds: 900 })],
    });
    render(<App />);

    // Test month view
    await openCalendar();
    let taskElement = screen.getByText("Team Sync").closest("div");
    fireEvent.contextMenu(taskElement as HTMLElement);
    let menu = await screen.findByRole("menu", { name: "Start Focus for Team Sync" });
    expect(within(menu).getByRole("menuitem", { name: "Quick 15" })).toBeInTheDocument();

    // Close the menu and try week view
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("menu", { name: /Start Focus for Team Sync/ }),
      ).not.toBeInTheDocument(),
    );

    // Switch to week view and test there — Jul 1 is inside the Monday-aligned
    // week (Jun 29 – Jul 5) containing today.
    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    await screen.findByRole("heading", { name: "Jun 29 – Jul 5, 2026" });
    taskElement = screen.getByText("Team Sync").closest("div");
    fireEvent.contextMenu(taskElement as HTMLElement);
    menu = await screen.findByRole("menu", { name: "Start Focus for Team Sync" });
    expect(within(menu).getByRole("menuitem", { name: "Quick 15" })).toBeInTheDocument();
  });

  it("starting a Pomo from Calendar entry keeps you on Calendar view", async () => {
    const task = fakeTask("Dentist", {
      start_date: "2026-07-15T00:00:00Z",
      due_date: "2026-07-15T00:00:00Z",
      is_all_day: true,
    });
    installFakeApi({
      tasks: [task],
      timers: [fakeTimer("Deep Work 50", { duration_seconds: 3000 })],
    });
    render(<App />);

    await openCalendar();
    const monthCell = screen.getByLabelText("2026-07-15");
    const taskElement = within(monthCell).getByText("Dentist").closest("div");

    fireEvent.contextMenu(taskElement as HTMLElement);
    const menu = await screen.findByRole("menu", { name: "Start Focus for Dentist" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Deep Work 50" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Focus timer running, 50:00 left" }),
      ).toBeInTheDocument(),
    );
    // Still on Calendar view: no navigation happened
    expect(screen.getByRole("heading", { name: "July 2026" })).toBeInTheDocument();
  });
});
