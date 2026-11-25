import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeHabit, installFakeApi, type FakeApiState } from "./test/fakeApi";

function checkIn(api: FakeApiState, habitId: number, date: string, value = 1): void {
  api.checkIns.push({ id: 9500 + api.checkIns.length, habit_id: habitId, date, value });
}

// All tests pin the clock to Friday 2026-07-03, local noon, so "today" is
// deterministic in any timezone.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

async function openHabits(): Promise<void> {
  const nav = await screen.findByRole("navigation", { name: "Views" });
  fireEvent.click(within(nav).getByRole("link", { name: "Habits" }));
  await screen.findByRole("heading", { name: "Habits" });
}

/** History, Edit, Archive and Delete live behind one per-card menu now. */
async function openHabitMenu(name: string): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: `Actions for ${name}` }));
  await screen.findByRole("menu", { name: `Actions for ${name}` });
}

/** A Habit's cell in the week grid, by its spoken day and state. */
function cell(habit: string, day: string, state: string): Promise<HTMLElement> {
  return screen.findByRole("button", { name: `${habit}, ${day}: ${state}` });
}

describe("Habits week grid", () => {
  it("shows every active Habit in one Monday-first week grid and backfills past days", async () => {
    const api = installFakeApi({
      habits: [fakeHabit("Meditate"), fakeHabit("Review", { frequency: "FREQ=WEEKLY;BYDAY=MO" })],
    });
    render(<App />);
    await openHabits();

    const grid = await screen.findByRole("table", { name: "Habits this week" });
    expect(
      within(grid).getByRole("columnheader", { name: "Today, Friday, Jul 3" }),
    ).toBeInTheDocument();
    expect(within(grid).getByRole("row", { name: /Review/ })).toBeInTheDocument();
    const cell = within(grid).getByRole("button", { name: "Meditate, Thursday, Jul 2: missed" });
    fireEvent.click(cell);
    await screen.findByRole("button", { name: "Meditate, Thursday, Jul 2: checked in" });
    expect(
      api.requests.some((r) => r.method === "PUT" && r.url.endsWith("/check-ins/2026-07-02")),
    ).toBe(true);
  });

  it("opens from the sidebar and queries the local day", async () => {
    const api = installFakeApi();
    render(<App />);

    await openHabits();

    await waitFor(() => {
      expect(api.requests.some((r) => r.method === "GET" && r.url === "/api/v1/habits")).toBe(true);
    });
    expect(
      api.requests.some((r) => r.method === "GET" && r.url === "/api/v1/check-ins?date=2026-07-03"),
    ).toBe(true);
  });

  it("tells done, partial, open today, missed, not scheduled and future cells apart", async () => {
    const api = installFakeApi({
      habits: [
        fakeHabit("Drink water", { type: "numeric", target: 4, step: 2 }),
        fakeHabit("Review week", { frequency: "FREQ=WEEKLY;BYDAY=MO" }),
      ],
    });
    const water = api.habits[0]?.id ?? 0;
    checkIn(api, water, "2026-06-29", 4);
    checkIn(api, water, "2026-06-30", 2);
    render(<App />);
    await openHabits();

    const grid = await screen.findByRole("table", { name: "Habits this week" });
    const state = (name: string): string | undefined =>
      [...within(grid).getByLabelText(name).classList].find((c) => c.startsWith("state-"));
    await cell("Drink water", "Monday, Jun 29", "checked in");
    expect(state("Drink water, Monday, Jun 29: checked in")).toBe("state-done");
    expect(state("Drink water, Tuesday, Jun 30: in progress: 2 of 4")).toBe("state-partial");
    expect(state("Drink water, Wednesday, Jul 1: missed")).toBe("state-missed");
    expect(state("Drink water, Friday, Jul 3: not yet checked in")).toBe("state-open-today");
    expect(state("Review week, Friday, Jul 3: not scheduled")).toBe("state-not-scheduled");
    // A partial day sits on a lighter step of the heat ramp than a full one.
    expect(within(grid).getByLabelText("Drink water, Monday, Jun 29: checked in")).toHaveClass(
      "level-4",
    );
    expect(
      within(grid).getByLabelText("Drink water, Tuesday, Jun 30: in progress: 2 of 4"),
    ).toHaveClass("level-2");
    // Future days are inert: not buttons, so a tap can't write.
    const future = within(grid).getByRole("img", { name: "Drink water, Saturday, Jul 4: future" });
    fireEvent.click(future);
    expect(api.requests.filter((r) => r.method === "PUT")).toHaveLength(0);
  });

  it("checks a Boolean Habit in with one tap and undoes it with another", async () => {
    const api = installFakeApi({ habits: [fakeHabit("Meditate")] });
    render(<App />);
    await openHabits();

    fireEvent.click(await cell("Meditate", "Friday, Jul 3", "not yet checked in"));

    await cell("Meditate", "Friday, Jul 3", "checked in");
    expect(
      api.requests.some(
        (r) =>
          r.method === "PUT" &&
          r.url === "/api/v1/habits/" + String(api.habits[0]?.id) + "/check-ins/2026-07-03",
      ),
    ).toBe(true);
    expect(api.checkIns).toHaveLength(1);
    expect(api.checkIns[0]?.value).toBe(1);

    fireEvent.click(await cell("Meditate", "Friday, Jul 3", "checked in"));

    await cell("Meditate", "Friday, Jul 3", "not yet checked in");
    expect(api.checkIns).toHaveLength(0);
  });

  it("shows Not yet and a visible Check in action on today's open cell, in words", async () => {
    installFakeApi({ habits: [fakeHabit("Meditate")] });
    render(<App />);
    await openHabits();

    // On screen, not only in the accessible name: the state and what a tap does.
    const today = await cell("Meditate", "Friday, Jul 3", "not yet checked in");
    expect(today).toHaveTextContent("Not yet");
    expect(today).toHaveTextContent("Check in");
    // Other open days carry no words; only today is still open.
    expect(await cell("Meditate", "Thursday, Jul 2", "missed")).toHaveTextContent("");

    fireEvent.click(today);

    const done = await cell("Meditate", "Friday, Jul 3", "checked in");
    expect(done).not.toHaveTextContent("Not yet");
  });

  it("re-taps keep one Check-in row per habit and date", async () => {
    const api = installFakeApi({ habits: [fakeHabit("Meditate")] });
    render(<App />);
    await openHabits();

    fireEvent.click(await cell("Meditate", "Friday, Jul 3", "not yet checked in"));
    fireEvent.click(await cell("Meditate", "Friday, Jul 3", "checked in"));
    fireEvent.click(await cell("Meditate", "Friday, Jul 3", "not yet checked in"));

    await cell("Meditate", "Friday, Jul 3", "checked in");
    expect(api.checkIns).toHaveLength(1);
  });

  it("adds a step to a Numeric Habit from today's cell and completes at the Target", async () => {
    const api = installFakeApi({
      habits: [fakeHabit("Drink water", { type: "numeric", target: 4, step: 2, unit: "glasses" })],
    });
    render(<App />);
    await openHabits();

    fireEvent.click(await cell("Drink water", "Friday, Jul 3", "not yet checked in"));
    const partial = await cell("Drink water", "Friday, Jul 3", "in progress: 2 of 4 glasses");
    expect(partial).toHaveTextContent("2/4");

    fireEvent.click(partial);
    expect(await cell("Drink water", "Friday, Jul 3", "checked in")).toBeInTheDocument();

    expect(api.checkIns).toHaveLength(1);
    expect(api.checkIns[0]?.value).toBe(4);
    const puts = api.requests.filter((r) => r.method === "PUT");
    expect(puts.map((r) => r.body)).toEqual([{ value: 2 }, { value: 4 }]);
  });
});

describe("Habit Streak and history strip", () => {
  it("shows the Streak and a recent-days strip that reads misses only on scheduled days", async () => {
    const api = installFakeApi({ habits: [fakeHabit("Meditate")] });
    const habitId = api.habits[0]?.id ?? 0;
    checkIn(api, habitId, "2026-06-30");
    checkIn(api, habitId, "2026-07-01");
    checkIn(api, habitId, "2026-07-02");
    render(<App />);
    await openHabits();

    // Yesterday closed a 3-day run; today is graced (not yet checked in),
    // same grace the server's Streak rule gives it.
    expect(await screen.findByText("Streak: 3")).toBeInTheDocument();

    const strip = screen.getByRole("group", { name: "Recent days for Meditate" });
    const days = within(strip).getAllByRole("button");
    // Three weeks of scheduled days, oldest first — enough to read a pattern.
    expect(days).toHaveLength(21);
    expect(days.slice(-4).map((day) => day.getAttribute("aria-label"))).toEqual([
      "Jun 30: checked in",
      "Jul 1: checked in",
      "Jul 2: checked in",
      "Jul 3: not yet checked in",
    ]);
    expect(days[0]?.getAttribute("aria-label")).toBe("Jun 13: missed");
  });

  it("refreshes the Streak when a Check-in is made or undone, without a reload", async () => {
    const api = installFakeApi({ habits: [fakeHabit("Meditate")] });
    const habitId = api.habits[0]?.id ?? 0;
    checkIn(api, habitId, "2026-06-30");
    checkIn(api, habitId, "2026-07-01");
    checkIn(api, habitId, "2026-07-02");
    render(<App />);
    await openHabits();

    // Today is graced while un-checked, so the run so far reads as 3.
    expect(await screen.findByText("Streak: 3")).toBeInTheDocument();

    fireEvent.click(await cell("Meditate", "Friday, Jul 3", "not yet checked in"));
    expect(await screen.findByText("Streak: 4")).toBeInTheDocument();

    fireEvent.click(await cell("Meditate", "Friday, Jul 3", "checked in"));
    expect(await screen.findByText("Streak: 3")).toBeInTheDocument();
  });

  it("skips a non-daily Habit's off days rather than reading them as missed", async () => {
    const api = installFakeApi({
      habits: [fakeHabit("Review week", { frequency: "FREQ=WEEKLY;BYDAY=MO" })],
    });
    const habitId = api.habits[0]?.id ?? 0;
    checkIn(api, habitId, "2026-06-29");
    render(<App />);
    await openHabits();

    // Friday 2026-07-03 is not one of this Habit's scheduled days, so it
    // never appears in the strip at all — it can't be shown as missed.
    const strip = screen.getByRole("group", { name: "Recent days for Review week" });
    const days = await within(strip).findAllByRole("button");
    // Only Mondays appear — Friday 2026-07-03 is never in the strip, so it
    // can't read as missed. Three weeks' worth means 21 scheduled Mondays.
    expect(days).toHaveLength(21);
    expect(days.slice(-2).map((day) => day.getAttribute("aria-label"))).toEqual([
      "Jun 22: missed",
      "Jun 29: checked in",
    ]);
    expect(days[0]?.getAttribute("aria-label")).toBe("Feb 9: missed");
  });

  it("shows a Numeric Habit's partial progress toward its Target, not a binary state", async () => {
    const api = installFakeApi({
      habits: [fakeHabit("Drink water", { type: "numeric", target: 4, step: 2, unit: "glasses" })],
    });
    const habitId = api.habits[0]?.id ?? 0;
    checkIn(api, habitId, "2026-07-01", 4);
    checkIn(api, habitId, "2026-07-02", 2);
    render(<App />);
    await openHabits();

    const strip = await screen.findByRole("group", { name: "Recent days for Drink water" });
    const full = within(strip).getByRole("button", { name: "Jul 1: checked in" });
    const partial = within(strip).getByRole("button", {
      name: "Jul 2: in progress: 2 of 4 glasses",
    });
    expect(full).toHaveClass("level-4");
    expect(partial).toHaveClass("level-2");
  });

  it("reads a nearly met Target as in progress in the strip, as the week grid does", async () => {
    const api = installFakeApi({
      habits: [fakeHabit("Drink water", { type: "numeric", target: 5, step: 1, unit: "glasses" })],
    });
    checkIn(api, api.habits[0]?.id ?? 0, "2026-07-01", 4);
    render(<App />);
    await openHabits();

    // 4 of 5 is not a met Target: neither view may call it checked in.
    expect(
      await cell("Drink water", "Wednesday, Jul 1", "in progress: 4 of 5 glasses"),
    ).toHaveClass("level-3");
    const strip = await screen.findByRole("group", { name: "Recent days for Drink water" });
    expect(
      within(strip).getByRole("button", { name: "Jul 1: in progress: 4 of 5 glasses" }),
    ).toHaveClass("level-3");
  });

  it("backfills a missed day straight from the card strip, and a second tap clears it", async () => {
    const api = installFakeApi({ habits: [fakeHabit("Meditate")] });
    const habitId = api.habits[0]?.id ?? 0;
    render(<App />);
    await openHabits();

    const strip = await screen.findByRole("group", { name: "Recent days for Meditate" });
    fireEvent.click(within(strip).getByRole("button", { name: "Jul 2: missed" }));

    // The square turns green in place — no Edit, no history panel.
    const checked = await within(strip).findByRole("button", { name: "Jul 2: checked in" });
    expect(checked).toHaveClass("level-4");
    expect(checked).toHaveAttribute("aria-pressed", "true");
    expect(
      api.requests.some(
        (r) => r.method === "PUT" && r.url === `/api/v1/habits/${habitId}/check-ins/2026-07-02`,
      ),
    ).toBe(true);
    // Yesterday backfilled, today graced: the Streak follows without a reload.
    expect(await screen.findByText("Streak: 1")).toBeInTheDocument();

    fireEvent.click(checked);

    await within(strip).findByRole("button", { name: "Jul 2: missed" });
    expect(api.checkIns).toHaveLength(0);
    expect(await screen.findByText("Streak: 0")).toBeInTheDocument();
  });

  it("adds one step per tap on a Numeric Habit's past day, clearing a met Target", async () => {
    const api = installFakeApi({
      habits: [fakeHabit("Drink water", { type: "numeric", target: 4, step: 2, unit: "glasses" })],
    });
    render(<App />);
    await openHabits();

    const strip = await screen.findByRole("group", { name: "Recent days for Drink water" });
    fireEvent.click(within(strip).getByRole("button", { name: "Jul 1: missed" }));

    await within(strip).findByRole("button", { name: "Jul 1: in progress: 2 of 4 glasses" });
    fireEvent.click(
      within(strip).getByRole("button", { name: "Jul 1: in progress: 2 of 4 glasses" }),
    );

    await within(strip).findByRole("button", { name: "Jul 1: checked in" });
    expect(api.checkIns).toHaveLength(1);
    expect(api.checkIns[0]?.value).toBe(4);

    fireEvent.click(within(strip).getByRole("button", { name: "Jul 1: checked in" }));

    await within(strip).findByRole("button", { name: "Jul 1: missed" });
    expect(api.checkIns).toHaveLength(0);
  });

  it("keeps the grid's today cell in step when today's strip square is tapped", async () => {
    const api = installFakeApi({ habits: [fakeHabit("Meditate")] });
    render(<App />);
    await openHabits();

    const strip = await screen.findByRole("group", { name: "Recent days for Meditate" });
    fireEvent.click(within(strip).getByRole("button", { name: "Jul 3: not yet checked in" }));

    // The strip and the grid are two views of the same day.
    expect(await cell("Meditate", "Friday, Jul 3", "checked in")).toBeInTheDocument();
    expect(api.checkIns).toHaveLength(1);

    fireEvent.click(await within(strip).findByRole("button", { name: "Jul 3: checked in" }));

    expect(await cell("Meditate", "Friday, Jul 3", "not yet checked in")).toBeInTheDocument();
    expect(api.checkIns).toHaveLength(0);
  });

  it("reads days on the far side of New Year, where the strip outruns one calendar year", async () => {
    vi.setSystemTime(new Date(2026, 0, 5, 12, 0, 0));
    const api = installFakeApi({ habits: [fakeHabit("Meditate")] });
    const habitId = api.habits[0]?.id ?? 0;
    checkIn(api, habitId, "2025-12-30");
    render(<App />);
    await openHabits();

    // The strip walks 21 days back from Jan 5, so most of it is last
    // December — days a single year's heatmap would never mention.
    const strip = await screen.findByRole("group", { name: "Recent days for Meditate" });
    const done = await within(strip).findByRole("button", { name: "Dec 30: checked in" });

    // And a day that reads as done must clear on tap, not check in again.
    fireEvent.click(done);
    await within(strip).findByRole("button", { name: "Dec 30: missed" });
    expect(api.checkIns).toHaveLength(0);
  });

  it("leaves an archived Habit's strip a record rather than something to check in on", async () => {
    installFakeApi({ habits: [fakeHabit("Meditate", { is_archived: true })] });
    render(<App />);
    await openHabits();

    const strip = await screen.findByRole("group", { name: "Recent days for Meditate" });
    expect(within(strip).queryAllByRole("button")).toHaveLength(0);
    expect(within(strip).getAllByRole("img")).toHaveLength(21);
  });

  it("never lets a rapid double tap on one day lose a step", async () => {
    const api = installFakeApi({
      habits: [fakeHabit("Drink water", { type: "numeric", target: 6, step: 2, unit: "glasses" })],
    });
    render(<App />);
    await openHabits();

    const strip = await screen.findByRole("group", { name: "Recent days for Drink water" });
    const day = within(strip).getByRole("button", { name: "Jul 1: missed" });
    fireEvent.click(day);
    fireEvent.click(day);

    // The second tap lands on a stale value, so it is dropped rather than
    // writing 2 twice — the day reads 2, not a silently lost step.
    await within(strip).findByRole("button", { name: "Jul 1: in progress: 2 of 6 glasses" });
    expect(api.requests.filter((r) => r.method === "PUT")).toHaveLength(1);
  });
});

describe("Habit start: days before it read as not started, never missed", () => {
  /** Every accessible name under `root` that claims a miss. */
  function misses(root: HTMLElement = document.body): string[] {
    return [...root.querySelectorAll("[aria-label]")]
      .map((element) => element.getAttribute("aria-label") ?? "")
      .filter((label) => label.includes("missed"));
  }

  it("shows a Habit created today with no misses in the week grid or the strip", async () => {
    const api = installFakeApi();
    render(<App />);
    await openHabits();

    fireEvent.click(screen.getByRole("button", { name: "Add Habit" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Meditate" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // Today is open, with its check-in control right there.
    expect(await cell("Meditate", "Friday, Jul 3", "not yet checked in")).toBeInTheDocument();
    // Earlier this week the Habit did not exist yet: tappable, but not a miss.
    expect(await cell("Meditate", "Monday, Jun 29", "not started")).toHaveClass(
      "state-not-started",
    );
    expect(await cell("Meditate", "Thursday, Jul 2", "not started")).toBeInTheDocument();
    const strip = await screen.findByRole("group", { name: "Recent days for Meditate" });
    const labels = within(strip)
      .getAllByRole("button")
      .map((day) => day.getAttribute("aria-label"));
    expect(labels).toHaveLength(21);
    expect(labels[0]).toBe("Jun 13: not started");
    expect(labels.slice(-2)).toEqual(["Jul 2: not started", "Jul 3: not yet checked in"]);
    expect(labels.filter((label) => label?.endsWith(": not started"))).toHaveLength(20);
    expect(misses()).toEqual([]);
    expect(api.habits[0]?.created_at.slice(0, 10)).toBe("2026-07-03");
  });

  it("starts the Habit at a real Check-in made before it was created", async () => {
    const api = installFakeApi({
      habits: [fakeHabit("Meditate", { created_at: "2026-07-01T10:00:00Z" })],
    });
    checkIn(api, api.habits[0]?.id ?? 0, "2026-06-29");
    render(<App />);
    await openHabits();

    // The days between that Check-in and creation count, so an empty one is a miss.
    expect(await cell("Meditate", "Monday, Jun 29", "checked in")).toBeInTheDocument();
    expect(await cell("Meditate", "Tuesday, Jun 30", "missed")).toHaveClass("state-missed");
    const strip = await screen.findByRole("group", { name: "Recent days for Meditate" });
    expect(within(strip).getByRole("button", { name: "Jun 28: not started" })).toHaveClass(
      "level-0",
      "not-started",
    );
    expect(within(strip).getByRole("button", { name: "Jun 30: missed" })).toBeInTheDocument();
  });

  it("backfills a day before the Habit start from the strip, which moves the start back", async () => {
    const api = installFakeApi({
      habits: [fakeHabit("Meditate", { created_at: "2026-07-03T10:00:00Z" })],
    });
    const habitId = api.habits[0]?.id ?? 0;
    render(<App />);
    await openHabits();

    const strip = await screen.findByRole("group", { name: "Recent days for Meditate" });
    fireEvent.click(await within(strip).findByRole("button", { name: "Jun 30: not started" }));

    expect(await within(strip).findByRole("button", { name: "Jun 30: checked in" })).toHaveClass(
      "level-4",
    );
    expect(api.checkIns).toEqual([
      expect.objectContaining({ habit_id: habitId, date: "2026-06-30" }),
    ]);
    // The days since the backfill now count; the days before it still don't.
    expect(await within(strip).findByRole("button", { name: "Jul 1: missed" })).toBeInTheDocument();
    expect(within(strip).getByRole("button", { name: "Jun 29: not started" })).toBeInTheDocument();
    expect(await cell("Meditate", "Thursday, Jul 2", "missed")).toBeInTheDocument();
    expect(await cell("Meditate", "Monday, Jun 29", "not started")).toBeInTheDocument();
  });

  it("keeps a weekday Habit's off days not scheduled, before and after its start", async () => {
    installFakeApi({
      habits: [
        fakeHabit("Review", {
          frequency: "FREQ=WEEKLY;BYDAY=MO,WE",
          created_at: "2026-07-01T10:00:00Z",
        }),
      ],
    });
    render(<App />);
    await openHabits();

    expect(await cell("Review", "Monday, Jun 29", "not started")).toBeInTheDocument();
    expect(await cell("Review", "Tuesday, Jun 30", "not scheduled")).toBeInTheDocument();
    expect(await cell("Review", "Wednesday, Jul 1", "missed")).toBeInTheDocument();
    expect(await cell("Review", "Thursday, Jul 2", "not scheduled")).toBeInTheDocument();
    const strip = await screen.findByRole("group", { name: "Recent days for Review" });
    // The strip shows scheduled days only: Mondays and Wednesdays.
    expect(
      within(strip)
        .getAllByRole("button")
        .slice(-3)
        .map((day) => day.getAttribute("aria-label")),
    ).toEqual(["Jun 24: not started", "Jun 29: not started", "Jul 1: missed"]);
  });

  it("explains every day symbol in a visible legend, without relying on hover", async () => {
    installFakeApi({ habits: [fakeHabit("Meditate")] });
    render(<App />);
    await openHabits();

    const legend = await screen.findByRole("list", { name: "What the days mean" });
    expect(
      within(legend)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Checked in",
      "In progress",
      "Not yet: today, still open",
      "Missed",
      "Not started: before the Habit began",
      "Not scheduled",
      "Paused: not counted, neither done nor missed",
      "Future",
    ]);
    expect(legend).toBeVisible();
  });

  it("reads days before the creation day as not started while the stats are still loading", async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const api = installFakeApi({
      habits: [fakeHabit("Meditate", { created_at: "2026-07-02T10:00:00Z" })],
    });
    api.readGate = { match: (path) => path.endsWith("/stats"), gate };
    render(<App />);
    await openHabits();

    expect(await cell("Meditate", "Wednesday, Jul 1", "not started")).toBeInTheDocument();
    expect(await cell("Meditate", "Thursday, Jul 2", "missed")).toBeInTheDocument();
    expect(misses().filter((label) => !label.includes("Jul 2"))).toEqual([]);
    release();
    expect(await screen.findByRole("group", { name: "Recent days for Meditate" })).toBeVisible();
  });
});

describe("Managing Habits", () => {
  it("creates a Numeric Habit on chosen weekdays from the form", async () => {
    const api = installFakeApi();
    render(<App />);
    await openHabits();

    fireEvent.click(screen.getByRole("button", { name: "Add Habit" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Drink water" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Habit type" }), {
      target: { value: "numeric" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Target" }), {
      target: { value: "8" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Step" }), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Unit"), { target: { value: "glasses" } });
    fireEvent.click(screen.getByRole("button", { name: "Icon" }));
    fireEvent.click(
      within(await screen.findByRole("dialog", { name: "Choose an icon" })).getByRole("button", {
        name: "droplet",
      }),
    );
    fireEvent.change(screen.getByLabelText("Encouragement"), {
      target: { value: "Stay hydrated!" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Frequency" }), {
      target: { value: "weekdays" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Repeat on Mon" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Repeat on Fri" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // Friday 2026-07-03 is one of the chosen weekdays, so today's cell is open.
    expect(await cell("Drink water", "Friday, Jul 3", "not yet checked in")).toBeInTheDocument();
    const post = api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/habits");
    expect(post?.body).toEqual({
      name: "Drink water",
      type: "numeric",
      target: 8,
      step: 2,
      unit: "glasses",
      icon: "💧",
      encouragement: "Stay hydrated!",
      frequency: "FREQ=WEEKLY;BYDAY=MO,FR",
    });
  });

  it("creates a Habit with an icon chosen from the emoji picker", async () => {
    const api = installFakeApi();
    render(<App />);
    await openHabits();

    fireEvent.click(screen.getByRole("button", { name: "Add Habit" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Read" } });

    fireEvent.click(screen.getByRole("button", { name: "Icon" }));
    const picker = await screen.findByRole("dialog", { name: "Choose an icon" });
    fireEvent.click(within(picker).getByRole("button", { name: "books" }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const post = api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/habits");
      expect(post?.body).toMatchObject({ name: "Read", icon: "📚" });
    });
  });

  it("shows the Habit's current icon on the field and swaps it for a new pick", async () => {
    installFakeApi({ habits: [fakeHabit("Meditate", { icon: "🧘" })] });
    render(<App />);
    await openHabits();

    await openHabitMenu("Meditate");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit Meditate" }));
    const field = screen.getByRole("button", { name: "Icon" });
    expect(field).toHaveTextContent("🧘");

    fireEvent.click(field);
    const picker = await screen.findByRole("dialog", { name: "Choose an icon" });
    fireEvent.click(within(picker).getByRole("button", { name: "books" }));

    expect(screen.queryByRole("dialog", { name: "Choose an icon" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Icon" })).toHaveTextContent("📚");
  });

  it("removes a Habit's icon from the picker", async () => {
    const api = installFakeApi({ habits: [fakeHabit("Meditate", { icon: "🧘" })] });
    render(<App />);
    await openHabits();

    await openHabitMenu("Meditate");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit Meditate" }));
    fireEvent.click(screen.getByRole("button", { name: "Icon" }));
    const picker = await screen.findByRole("dialog", { name: "Choose an icon" });
    fireEvent.click(within(picker).getByRole("button", { name: "No icon" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patch = api.requests.find((r) => r.method === "PATCH");
      expect(patch?.body).toMatchObject({ icon: null });
    });
  });

  it("creates a Habit with a colour chosen from the palette", async () => {
    const api = installFakeApi();
    render(<App />);
    await openHabits();

    fireEvent.click(screen.getByRole("button", { name: "Add Habit" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Stretch" } });
    fireEvent.click(screen.getByRole("radio", { name: "Teal" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const post = api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/habits");
      expect(post?.body).toMatchObject({ name: "Stretch", color: "#12a594" });
    });
  });

  it("offers twelve colours and no way to type a colour code", async () => {
    installFakeApi();
    render(<App />);
    await openHabits();

    fireEvent.click(screen.getByRole("button", { name: "Add Habit" }));

    const palette = screen.getByRole("group", { name: "Color" });
    const names = within(palette)
      .getAllByRole("radio")
      .map((radio) => radio.getAttribute("aria-label"));
    expect(names).toEqual([
      "No colour",
      "Blue",
      "Indigo",
      "Plum",
      "Pink",
      "Red",
      "Orange",
      "Amber",
      "Lime",
      "Green",
      "Teal",
      "Cyan",
      "Slate",
    ]);
    expect(within(palette).queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("preselects the Habit's colour when editing and can clear it", async () => {
    const api = installFakeApi({ habits: [fakeHabit("Meditate", { color: "#e5484d" })] });
    render(<App />);
    await openHabits();

    await openHabitMenu("Meditate");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit Meditate" }));
    expect(screen.getByRole("radio", { name: "Red" })).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: "No colour" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patch = api.requests.find((r) => r.method === "PATCH");
      expect(patch?.body).toMatchObject({ color: null });
    });
  });

  it("reopens the edit form pre-populated with the Habit's saved fields", async () => {
    installFakeApi({
      habits: [
        fakeHabit("Drink water", {
          type: "numeric",
          target: 8,
          step: 2,
          unit: "glasses",
          icon: "💧",
          color: "#12a594",
          encouragement: "Stay hydrated!",
          frequency: "FREQ=WEEKLY;BYDAY=MO,FR",
        }),
      ],
    });
    render(<App />);
    await openHabits();

    await openHabitMenu("Drink water");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit Drink water" }));

    expect(screen.getByLabelText("Name")).toHaveValue("Drink water");
    expect(screen.getByRole("combobox", { name: "Habit type" })).toHaveValue("numeric");
    expect(screen.getByRole("spinbutton", { name: "Target" })).toHaveValue(8);
    expect(screen.getByRole("spinbutton", { name: "Step" })).toHaveValue(2);
    expect(screen.getByLabelText("Unit")).toHaveValue("glasses");
    expect(screen.getByRole("button", { name: "Icon" })).toHaveTextContent("💧");
    expect(screen.getByRole("radio", { name: "Teal" })).toBeChecked();
    expect(screen.getByLabelText("Encouragement")).toHaveValue("Stay hydrated!");
    expect(screen.getByRole("combobox", { name: "Frequency" })).toHaveValue("weekdays");
    expect(screen.getByRole("checkbox", { name: "Repeat on Mon" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Repeat on Fri" })).toBeChecked();
  });

  it("edits a Habit in place", async () => {
    const api = installFakeApi({ habits: [fakeHabit("Meditate")] });
    render(<App />);
    await openHabits();

    await openHabitMenu("Meditate");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit Meditate" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Sit still" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const grid = await screen.findByRole("table", { name: "Habits this week" });
    await waitFor(() => expect(within(grid).getByText("Sit still")).toBeInTheDocument());
    expect(api.habits[0]?.name).toBe("Sit still");
  });

  it("edits a Boolean Habit into a Numeric one with target, unit and frequency", async () => {
    const api = installFakeApi({ habits: [fakeHabit("Meditate")] });
    render(<App />);
    await openHabits();

    await openHabitMenu("Meditate");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit Meditate" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Habit type" }), {
      target: { value: "numeric" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Target" }), {
      target: { value: "20" },
    });
    fireEvent.change(screen.getByLabelText("Unit"), { target: { value: "minutes" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Frequency" }), {
      target: { value: "timesPerWeek" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Times a week" }), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await cell("Meditate", "Friday, Jul 3", "not yet checked in")).toBeInTheDocument();
    const patch = api.requests.find((r) => r.method === "PATCH");
    expect(patch?.body).toMatchObject({
      type: "numeric",
      target: 20,
      step: 1,
      unit: "minutes",
      frequency: "FREQ=WEEKLY;TT_TIMES=5",
    });
    expect(api.habits[0]?.target).toBe(20);
  });

  it("deletes a Habit after confirming", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const api = installFakeApi({ habits: [fakeHabit("Meditate")] });
    render(<App />);
    await openHabits();

    await openHabitMenu("Meditate");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete habit Meditate" }));

    await waitFor(() => expect(screen.queryByText("Meditate")).not.toBeInTheDocument());
    expect(api.habits).toHaveLength(0);
  });

  it("archiving moves a Habit out of today into Archived; unarchiving restores it", async () => {
    const api = installFakeApi({ habits: [fakeHabit("Meditate")] });
    render(<App />);
    await openHabits();

    await openHabitMenu("Meditate");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Archive Meditate" }));

    const archived = await screen.findByRole("list", { name: "Archived habits" });
    expect(within(archived).getByText("Meditate")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Habits this week" })).not.toBeInTheDocument();
    expect(api.habits[0]?.is_archived).toBe(true);
    // Archived habits keep no check-in controls — today is not their screen.
    expect(
      screen.queryByRole("button", { name: /^Meditate, Friday, Jul 3/ }),
    ).not.toBeInTheDocument();

    await openHabitMenu("Meditate");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Unarchive Meditate" }));

    await waitFor(() =>
      expect(
        within(screen.getByRole("table", { name: "Habits this week" })).getByText("Meditate"),
      ).toBeInTheDocument(),
    );
    expect(api.habits[0]?.is_archived).toBe(false);
  });

  it("folds History, Edit, Archive and Delete into one keyboard-reachable menu", async () => {
    installFakeApi({ habits: [fakeHabit("Meditate")] });
    render(<App />);
    await openHabits();

    const trigger = await screen.findByRole("button", { name: "Actions for Meditate" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // No permanent action buttons on the card — only the one trigger.
    expect(screen.queryByRole("button", { name: "Edit Meditate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete habit Meditate" })).not.toBeInTheDocument();

    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(trigger);
    const menu = await screen.findByRole("menu", { name: "Actions for Meditate" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.getAttribute("aria-label")),
    ).toEqual([
      "History Meditate",
      "Edit Meditate",
      "Pause Meditate",
      "Archive Meditate",
      "Delete habit Meditate",
    ]);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("menu", { name: "Actions for Meditate" })).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it("opens History from the actions menu", async () => {
    const api = installFakeApi({ habits: [fakeHabit("Meditate")] });
    checkIn(api, api.habits[0]?.id ?? 0, "2026-07-02");
    render(<App />);
    await openHabits();

    await openHabitMenu("Meditate");
    fireEvent.click(await screen.findByRole("menuitem", { name: "History Meditate" }));

    expect(await screen.findByText("July 2026")).toBeInTheDocument();
  });

  it("marks a met Target with a mark, not colour alone", async () => {
    const api = installFakeApi({
      habits: [fakeHabit("Drink water", { type: "numeric", target: 2, step: 2, unit: "glasses" })],
    });
    checkIn(api, api.habits[0]?.id ?? 0, "2026-07-03", 2);
    render(<App />);
    await openHabits();

    const done = await cell("Drink water", "Friday, Jul 3", "checked in");
    expect(done.querySelector("svg")).not.toBeNull();
  });

  it("explains what a Habit is when none exist yet", async () => {
    installFakeApi({ habits: [] });
    render(<App />);

    await openHabits();

    expect(screen.getByText(/habits are things you check in on/i)).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Habits this week" })).not.toBeInTheDocument();
  });
});

describe("Habit type labels", () => {
  /** Picks a Habit type by the name a person reads, not by its stored value. */
  function chooseHabitType(name: string): void {
    const select = screen.getByRole("combobox", { name: "Habit type" });
    const option = within(select).getByRole<HTMLOptionElement>("option", { name });
    fireEvent.change(select, { target: { value: option.value } });
  }

  it("names the Habit types in plain language", async () => {
    installFakeApi();
    render(<App />);
    await openHabits();

    fireEvent.click(screen.getByRole("button", { name: "Add Habit" }));

    const select = screen.getByRole("combobox", { name: "Habit type" });
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Done / not yet", "Count"]);
  });

  it("still sends numeric when a Count Habit is created", async () => {
    const api = installFakeApi();
    render(<App />);
    await openHabits();

    fireEvent.click(screen.getByRole("button", { name: "Add Habit" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Drink water" } });
    chooseHabitType("Count");
    fireEvent.change(screen.getByRole("spinbutton", { name: "Target" }), {
      target: { value: "8" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(
        api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/habits")?.body,
      ).toMatchObject({ name: "Drink water", type: "numeric", target: 8 }),
    );
  });

  it("still sends boolean when a Habit is edited to Done / not yet", async () => {
    const api = installFakeApi({
      habits: [fakeHabit("Drink water", { type: "numeric", target: 8, unit: "glasses" })],
    });
    render(<App />);
    await openHabits();

    await openHabitMenu("Drink water");
    fireEvent.click(await screen.findByRole("menuitem", { name: "Edit Drink water" }));
    chooseHabitType("Done / not yet");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(api.requests.find((r) => r.method === "PATCH")?.body).toMatchObject({
        type: "boolean",
      }),
    );
  });
});
