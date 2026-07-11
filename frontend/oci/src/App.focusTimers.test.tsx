import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeFocusSession, fakeHabit, fakeTask, fakeTimer, installFakeApi } from "./test/fakeApi";

// All tests pin the clock to Friday 2026-07-03, local noon, so timers and
// "today" are deterministic in any timezone.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0));
  // A running Focus session persists itself; tests must not inherit one.
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

async function openFocus(): Promise<void> {
  const nav = await screen.findByRole("navigation", { name: "Views" });
  fireEvent.click(within(nav).getByRole("button", { name: "Focus" }));
  await screen.findByRole("heading", { name: "Focus" });
}

function tick(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("Timers", () => {
  it("starts a linked Pomo session in one tap with the preset's length", async () => {
    const habit = fakeHabit("Reading");
    const api = installFakeApi({
      habits: [habit],
      timers: [fakeTimer("Reading 30m", { duration_seconds: 1800, habit_id: habit.id })],
    });
    render(<App />);
    await openFocus();

    fireEvent.click(await screen.findByRole("button", { name: "Start timer Reading 30m" }));

    expect(screen.getByText("30:00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Link" })).toHaveValue(`habit:${habit.id}`);

    tick(60_000);
    expect(screen.getByText("29:00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(api.focusSessions).toHaveLength(1));
    expect(api.focusSessions[0]?.mode).toBe("pomo");
    expect(api.focusSessions[0]?.habit_id).toBe(habit.id);
  });

  it("starts a Stopwatch preset counting up", async () => {
    installFakeApi({
      timers: [fakeTimer("Deep work", { mode: "stopwatch", duration_seconds: null })],
    });
    render(<App />);
    await openFocus();

    fireEvent.click(await screen.findByRole("button", { name: "Start timer Deep work" }));
    tick(90_000);

    expect(screen.getByText("01:30")).toBeInTheDocument();
  });

  it("creates a Timer from the form", async () => {
    const api = installFakeApi();
    render(<App />);
    await openFocus();

    fireEvent.click(screen.getByRole("button", { name: "Add Timer" }));
    fireEvent.change(screen.getByLabelText("Timer name"), { target: { value: "Reading 30m" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Timer minutes" }), {
      target: { value: "30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByRole("button", { name: "Start timer Reading 30m" }),
    ).toBeInTheDocument();
    const post = api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/timers");
    expect(post?.body).toEqual({ name: "Reading 30m", mode: "pomo", duration_seconds: 1800 });
  });

  it("edits and deletes a Timer", async () => {
    const api = installFakeApi({ timers: [fakeTimer("Reading 30m")] });
    render(<App />);
    await openFocus();

    fireEvent.click(await screen.findByRole("button", { name: "Edit timer Reading 30m" }));
    fireEvent.change(screen.getByLabelText("Timer name"), { target: { value: "Reading 45m" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Timer minutes" }), {
      target: { value: "45" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByRole("button", { name: "Start timer Reading 45m" }),
    ).toBeInTheDocument();
    expect(api.timers[0]?.duration_seconds).toBe(2700);

    fireEvent.click(screen.getByRole("button", { name: "Delete timer Reading 45m" }));
    await waitFor(() => expect(api.timers).toHaveLength(0));
  });
});

describe("Focus statistics", () => {
  it("shows daily and weekly totals and per-Task / per-Habit breakdowns", async () => {
    const task = fakeTask("Write report");
    const habit = fakeHabit("Reading");
    installFakeApi({
      tasks: [task],
      habits: [habit],
      focusSessions: [
        fakeFocusSession({
          started_at: "2026-07-02T09:00:00Z",
          ended_at: "2026-07-02T09:30:00Z",
          task_id: task.id,
        }),
        fakeFocusSession({
          started_at: "2026-07-03T09:00:00Z",
          ended_at: "2026-07-03T09:30:00Z",
          pause_seconds: 300,
          habit_id: habit.id,
        }),
      ],
    });
    render(<App />);
    await openFocus();

    const daily = await screen.findByRole("list", { name: "Daily focus" });
    expect(within(daily).getByText("2026-07-02: 30 min")).toBeInTheDocument();
    expect(within(daily).getByText("2026-07-03: 25 min")).toBeInTheDocument();

    const weekly = screen.getByRole("list", { name: "Weekly focus" });
    expect(within(weekly).getByText("Week of 2026-06-29: 55 min")).toBeInTheDocument();

    const byTask = screen.getByRole("list", { name: "Focus by Task" });
    expect(within(byTask).getByText("Write report: 30 min")).toBeInTheDocument();

    const byHabit = screen.getByRole("list", { name: "Focus by Habit" });
    expect(within(byHabit).getByText("Reading: 25 min")).toBeInTheDocument();
  });

  it("refetches when the range changes", async () => {
    const api = installFakeApi({
      focusSessions: [
        fakeFocusSession({
          started_at: "2026-06-10T09:00:00Z",
          ended_at: "2026-06-10T09:30:00Z",
        }),
      ],
    });
    render(<App />);
    await openFocus();

    // The default range is the last 7 days: the June session is invisible.
    await screen.findByRole("list", { name: "Daily focus" });
    expect(screen.queryByText("2026-06-10: 30 min")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-06-01" } });

    expect(await screen.findByText("2026-06-10: 30 min")).toBeInTheDocument();
    expect(
      api.requests.some(
        (r) => r.method === "GET" && r.url.startsWith("/api/v1/focus-stats?start=2026-06-01"),
      ),
    ).toBe(true);
  });
});
