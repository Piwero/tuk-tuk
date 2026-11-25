import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeHabit, installFakeApi, type FakeApiState } from "./test/fakeApi";

// Issue #564: a User skips one scheduled Habit day on purpose, which reads
// differently from forgetting it (a missed day). All tests pin the clock to
// Friday 2026-07-03, local noon.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

function checkIn(api: FakeApiState, habitId: number, date: string, value = 1): void {
  api.checkIns.push({ id: 9500 + api.checkIns.length, habit_id: habitId, date, value });
}

async function openHabits(): Promise<void> {
  const nav = await screen.findByRole("navigation", { name: "Views" });
  fireEvent.click(within(nav).getByRole("link", { name: "Habits" }));
  await screen.findByRole("heading", { name: "Habits" });
}

async function openHabitMenu(name: string): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: `Actions for ${name}` }));
  await screen.findByRole("menu", { name: `Actions for ${name}` });
}

function weekGrid(): HTMLElement {
  return screen.getByRole("table", { name: "Habits this week" });
}

describe("A skipped day", () => {
  it("reads skipped, apart from a missed day, in words and shape", async () => {
    const habit = fakeHabit("Meditate", { skips: ["2026-07-01"] });
    installFakeApi({ habits: [habit] });
    render(<App />);
    await openHabits();

    const grid = weekGrid();
    // A skipped day is a picture, not a control: it refuses a Check-in.
    const skipped = await within(grid).findByRole("img", {
      name: "Meditate, Wednesday, Jul 1: skipped",
    });
    expect(skipped).toHaveClass("state-skipped");
    expect(skipped).not.toHaveClass("state-missed");
    const missed = within(grid).getByRole("button", { name: "Meditate, Thursday, Jul 2: missed" });
    expect(missed).toHaveClass("state-missed");
    expect(screen.getByRole("list", { name: "What the days mean" })).toHaveTextContent(
      "Skipped: on purpose, not counted, neither done nor missed",
    );
  });
});

describe("Skipping today", () => {
  it("skips from the actions menu, says so on the card, and can be undone", async () => {
    const api = installFakeApi({ habits: [fakeHabit("Meditate")] });
    const habitId = api.habits[0]?.id ?? 0;
    render(<App />);
    await openHabits();

    await openHabitMenu("Meditate");
    fireEvent.click(screen.getByRole("menuitem", { name: "Skip today for Meditate" }));

    const status = await screen.findByRole("status", { name: "Meditate skip" });
    expect(status).toHaveTextContent("Skipped today");
    expect(
      within(weekGrid()).getByRole("img", { name: "Meditate, Friday, Jul 3: skipped" }),
    ).toBeVisible();
    expect(
      api.requests.some(
        (r) => r.method === "PUT" && r.url === `/api/v1/habits/${habitId}/skips/2026-07-03`,
      ),
    ).toBe(true);

    fireEvent.click(within(status).getByRole("button", { name: "Undo skip" }));

    expect(
      await screen.findByRole("button", { name: "Meditate, Friday, Jul 3: not yet checked in" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Meditate skip" })).not.toBeInTheDocument();
    expect(api.habits[0]?.skips).toEqual([]);
  });

  it("is not offered once today is checked in", async () => {
    const api = installFakeApi({ habits: [fakeHabit("Meditate")] });
    checkIn(api, api.habits[0]?.id ?? 0, "2026-07-03");
    render(<App />);
    await openHabits();

    await openHabitMenu("Meditate");
    expect(
      screen.queryByRole("menuitem", { name: "Skip today for Meditate" }),
    ).not.toBeInTheDocument();
  });
});

describe("A Habit's history with skips", () => {
  async function openHistory(): Promise<void> {
    await openHabits();
    await openHabitMenu("Meditate");
    fireEvent.click(screen.getByRole("menuitem", { name: "History Meditate" }));
  }

  it("marks skipped days apart from missed ones, and refuses a backfill on them", async () => {
    const api = installFakeApi({ habits: [fakeHabit("Meditate", { skips: ["2026-07-01"] })] });
    render(<App />);
    await openHistory();

    const skippedDay = await screen.findByRole("button", { name: "2026-07-01: skipped" });
    expect(skippedDay).toBeDisabled();
    expect(skippedDay).toHaveClass("skipped");
    expect(screen.getByRole("button", { name: "2026-07-02" })).not.toHaveClass("skipped");
    expect(screen.getByRole("list", { name: "What the history shows" })).toHaveTextContent(
      "Skipped: on purpose, not counted, neither done nor missed",
    );
    const strip = screen.getByRole("group", { name: "Recent days for Meditate" });
    expect(within(strip).getByRole("img", { name: "Jul 1: skipped" })).toBeVisible();
    expect(api.requests.filter((r) => r.method === "PUT")).toHaveLength(0);
  });

  it("skips another day, and undoes it", async () => {
    const api = installFakeApi({ habits: [fakeHabit("Meditate")] });
    render(<App />);
    await openHistory();

    const form = await screen.findByRole("form", { name: "Skip a day of Meditate" });
    fireEvent.change(within(form).getByLabelText("Day to skip"), {
      target: { value: "2026-07-01" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Skip day" }));

    expect(await screen.findByRole("button", { name: "2026-07-01: skipped" })).toBeDisabled();
    expect(api.habits[0]?.skips).toEqual(["2026-07-01"]);

    fireEvent.click(screen.getByRole("button", { name: "Undo skip for Jul 1" }));

    expect(await screen.findByRole("button", { name: "2026-07-01" })).toBeEnabled();
    expect(api.habits[0]?.skips).toEqual([]);
  });

  it("names the Check-in that prevents a skip, and deletes nothing", async () => {
    const api = installFakeApi({ habits: [fakeHabit("Meditate")] });
    checkIn(api, api.habits[0]?.id ?? 0, "2026-07-01");
    render(<App />);
    await openHistory();

    const form = await screen.findByRole("form", { name: "Skip a day of Meditate" });
    fireEvent.change(within(form).getByLabelText("Day to skip"), {
      target: { value: "2026-07-01" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Skip day" }));

    const alert = await within(form).findByRole("alert");
    expect(alert).toHaveTextContent(
      "A Check-in on Jul 1 prevents this skip. Remove it or choose another day; nothing was deleted.",
    );
    expect(within(form).getByLabelText("Day to skip")).toHaveValue("2026-07-01");
    await waitFor(() => {
      expect(api.checkIns).toHaveLength(1);
    });
    expect(api.habits[0]?.skips).toEqual([]);
  });
});
