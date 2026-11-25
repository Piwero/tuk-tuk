import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeHabit, installFakeApi, type FakeApiState } from "./test/fakeApi";

// Issue #559: a User pauses a Habit for travel or illness, so those days
// are neither done nor missed. All tests pin the clock to Friday 2026-07-03,
// local noon.
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

function paused(habitId: number, start: string, end: string | null) {
  return { id: 700 + habitId, habit_id: habitId, start_date: start, end_date: end };
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

describe("A paused Habit's card", () => {
  it("states the interval and resume date, and reads paused days as paused, never missed", async () => {
    const habit = fakeHabit("Meditate");
    habit.pauses = [paused(habit.id, "2026-07-01", "2026-07-10")];
    const api = installFakeApi({ habits: [habit] });
    checkIn(api, habit.id, "2026-06-29");
    render(<App />);
    await openHabits();

    const status = await screen.findByRole("status", { name: "Meditate pause" });
    expect(status).toHaveTextContent("Paused Jul 1 – Jul 10");
    expect(status).toHaveTextContent("Resumes Jul 11");
    expect(within(status).getByRole("button", { name: "Edit pause" })).toBeInTheDocument();
    expect(within(status).getByRole("button", { name: "Resume today" })).toBeInTheDocument();

    const grid = weekGrid();
    // A paused day is a picture, not a control: it refuses a Check-in.
    const pausedDay = within(grid).getByRole("img", { name: "Meditate, Thursday, Jul 2: paused" });
    expect(pausedDay).toHaveClass("state-paused");
    expect(
      within(grid).getByRole("img", { name: "Meditate, Friday, Jul 3: paused" }),
    ).toBeVisible();
    // Before the pause, the usual rules: a missed day is still missed.
    expect(
      within(grid).getByRole("button", { name: "Meditate, Tuesday, Jun 30: missed" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "What the days mean" })).toHaveTextContent(
      "Paused: not counted, neither done nor missed",
    );
  });

  it("says an open-ended pause has no end date", async () => {
    const habit = fakeHabit("Meditate");
    habit.pauses = [paused(habit.id, "2026-07-01", null)];
    installFakeApi({ habits: [habit] });
    render(<App />);
    await openHabits();

    const status = await screen.findByRole("status", { name: "Meditate pause" });
    expect(status).toHaveTextContent("Paused since Jul 1, no end date");
  });

  it("explains that the Streak skips paused days", async () => {
    const habit = fakeHabit("Meditate");
    habit.pauses = [paused(habit.id, "2026-07-01", null)];
    installFakeApi({ habits: [habit] });
    render(<App />);
    await openHabits();

    const status = await screen.findByRole("status", { name: "Meditate pause" });
    expect(status).toHaveTextContent(
      "Paused days are skipped by the Streak, so it can differ from a perfect daily record.",
    );
  });

  it("keeps days before the Habit start Not started, even inside a pause", async () => {
    const habit = fakeHabit("Meditate", { created_at: "2026-07-02T10:00:00Z" });
    habit.pauses = [paused(habit.id, "2026-06-29", "2026-07-05")];
    installFakeApi({ habits: [habit] });
    render(<App />);
    await openHabits();

    await screen.findByRole("status", { name: "Meditate pause" });
    const grid = weekGrid();
    expect(
      within(grid).getByRole("button", { name: "Meditate, Monday, Jun 29: not started" }),
    ).toBeInTheDocument();
    expect(
      within(grid).getByRole("img", { name: "Meditate, Thursday, Jul 2: paused" }),
    ).toBeVisible();
  });
});

describe("Pausing a Habit", () => {
  it("pauses from the actions menu with a start and an optional end", async () => {
    const api = installFakeApi({ habits: [fakeHabit("Meditate")] });
    const habitId = api.habits[0]?.id ?? 0;
    render(<App />);
    await openHabits();

    await openHabitMenu("Meditate");
    fireEvent.click(screen.getByRole("menuitem", { name: "Pause Meditate" }));
    const form = await screen.findByRole("form", { name: "Pause Meditate" });
    expect(within(form).getByLabelText("First paused day")).toHaveValue("2026-07-03");
    fireEvent.change(within(form).getByLabelText("Last paused day (optional)"), {
      target: { value: "2026-07-08" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Save pause" }));

    const status = await screen.findByRole("status", { name: "Meditate pause" });
    expect(status).toHaveTextContent("Paused Jul 3 – Jul 8");
    expect(
      api.requests.find((r) => r.method === "POST" && r.url === `/api/v1/habits/${habitId}/pauses`)
        ?.body,
    ).toEqual({ start_date: "2026-07-03", end_date: "2026-07-08" });
  });

  it("names the Check-ins that prevent a pause, keeps them and keeps the attempted dates", async () => {
    const api = installFakeApi({ habits: [fakeHabit("Meditate")] });
    const habitId = api.habits[0]?.id ?? 0;
    checkIn(api, habitId, "2026-07-01");
    checkIn(api, habitId, "2026-07-02");
    render(<App />);
    await openHabits();

    await openHabitMenu("Meditate");
    fireEvent.click(screen.getByRole("menuitem", { name: "Pause Meditate" }));
    const form = await screen.findByRole("form", { name: "Pause Meditate" });
    fireEvent.change(within(form).getByLabelText("First paused day"), {
      target: { value: "2026-06-30" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Save pause" }));

    const alert = await within(form).findByRole("alert");
    expect(alert).toHaveTextContent(
      "Check-ins on Jul 1 and Jul 2 prevent this pause. Remove them or choose other dates; nothing was deleted.",
    );
    expect(within(form).getByLabelText("First paused day")).toHaveValue("2026-06-30");
    expect(api.checkIns).toHaveLength(2);
    expect(screen.queryByRole("status", { name: "Meditate pause" })).not.toBeInTheDocument();
  });
});

describe("Changing a pause", () => {
  it("edits the pause's dates", async () => {
    const habit = fakeHabit("Meditate");
    habit.pauses = [paused(habit.id, "2026-07-01", "2026-07-10")];
    const api = installFakeApi({ habits: [habit] });
    render(<App />);
    await openHabits();

    const status = await screen.findByRole("status", { name: "Meditate pause" });
    fireEvent.click(within(status).getByRole("button", { name: "Edit pause" }));
    const form = await screen.findByRole("form", { name: "Edit pause for Meditate" });
    expect(within(form).getByLabelText("First paused day")).toHaveValue("2026-07-01");
    fireEvent.change(within(form).getByLabelText("Last paused day (optional)"), {
      target: { value: "" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Save pause" }));

    await waitFor(() => {
      expect(screen.getByRole("status", { name: "Meditate pause" })).toHaveTextContent(
        "Paused since Jul 1, no end date",
      );
    });
    expect(
      api.requests.find(
        (r) =>
          r.method === "PATCH" && r.url === `/api/v1/habits/${habit.id}/pauses/${700 + habit.id}`,
      )?.body,
    ).toEqual({ start_date: "2026-07-01", end_date: null });
  });

  it("resumes today: the pause ends yesterday and today can be checked in again", async () => {
    const habit = fakeHabit("Meditate");
    habit.pauses = [paused(habit.id, "2026-07-01", null)];
    const api = installFakeApi({ habits: [habit] });
    render(<App />);
    await openHabits();

    const status = await screen.findByRole("status", { name: "Meditate pause" });
    fireEvent.click(within(status).getByRole("button", { name: "Resume today" }));

    const today = await screen.findByRole("button", {
      name: "Meditate, Friday, Jul 3: not yet checked in",
    });
    expect(today).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Meditate pause" })).not.toBeInTheDocument();
    expect(
      within(weekGrid()).getByRole("img", { name: "Meditate, Thursday, Jul 2: paused" }),
    ).toBeVisible();
    expect(api.habits[0]?.pauses).toEqual([paused(habit.id, "2026-07-01", "2026-07-02")]);
  });
});

describe("A paused Habit's history", () => {
  it("marks paused days apart from missed ones, and refuses a backfill on them", async () => {
    const habit = fakeHabit("Meditate");
    habit.pauses = [paused(habit.id, "2026-07-01", "2026-07-02")];
    const api = installFakeApi({ habits: [habit] });
    render(<App />);
    await openHabits();

    await openHabitMenu("Meditate");
    fireEvent.click(screen.getByRole("menuitem", { name: "History Meditate" }));

    const pausedDay = await screen.findByRole("button", { name: "2026-07-01: paused" });
    expect(pausedDay).toBeDisabled();
    expect(pausedDay).toHaveClass("paused");
    expect(screen.getByRole("button", { name: "2026-07-03" })).not.toHaveClass("paused");
    // The recent-days strip shows paused days as pictures, not controls.
    const strip = screen.getByRole("group", { name: "Recent days for Meditate" });
    expect(within(strip).getByRole("img", { name: "Jul 1: paused" })).toBeVisible();
    expect(api.requests.filter((r) => r.method === "PUT")).toHaveLength(0);
  });
});
