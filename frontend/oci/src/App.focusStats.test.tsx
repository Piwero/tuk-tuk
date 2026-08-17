import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeFocusSession, fakeHabit, fakeTask, installFakeApi } from "./test/fakeApi";

// All tests pin the clock to Friday 2026-07-03, local noon, so "today" (and
// the default 7-day statistics range) are deterministic in any timezone.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0));
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

async function openFocusStats(): Promise<void> {
  const nav = await screen.findByRole("navigation", { name: "Views" });
  fireEvent.click(within(nav).getByRole("link", { name: "Focus" }));
  await screen.findByRole("heading", { name: "Focus" });
  fireEvent.click(screen.getByRole("link", { name: "Statistics" }));
  await screen.findByRole("heading", { name: "Focus statistics" });
}

describe("Focus statistics", () => {
  it("shows daily and weekly totals and per-Task / per-Habit breakdowns as charts", async () => {
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
    await openFocusStats();

    const daily = await screen.findByRole("list", { name: "Daily focus" });
    expect(within(daily).getByRole("listitem", { name: "Jul 2: 30 min" })).toBeInTheDocument();
    expect(within(daily).getByRole("listitem", { name: "Jul 3: 25 min" })).toBeInTheDocument();

    const weekly = screen.getByRole("list", { name: "Weekly focus" });
    expect(
      within(weekly).getByRole("listitem", { name: "Week of Jun 29: 55 min" }),
    ).toBeInTheDocument();

    const byTask = screen.getByRole("list", { name: "Focus by Task" });
    expect(
      within(byTask).getByRole("listitem", { name: "Write report: 30 min" }),
    ).toBeInTheDocument();

    const byHabit = screen.getByRole("list", { name: "Focus by Habit" });
    expect(within(byHabit).getByRole("listitem", { name: "Reading: 25 min" })).toBeInTheDocument();
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
    await openFocusStats();

    // The default range is the last 7 days: the June session is invisible,
    // and the day grouping shows its empty state.
    expect(
      await screen.findByText("No focus time recorded in this range yet."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Jun 10: 30 min")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-06-01" } });

    expect(await screen.findByRole("listitem", { name: "Jun 10: 30 min" })).toBeInTheDocument();
    expect(
      api.requests.some(
        (r) => r.method === "GET" && r.url.startsWith("/api/v1/focus-stats?start=2026-06-01"),
      ),
    ).toBe(true);
  });

  it("shows an empty state per grouping when nothing is recorded", async () => {
    installFakeApi();
    render(<App />);
    await openFocusStats();

    expect(
      await screen.findByText("No focus time recorded in this range yet."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No full week of focus time recorded in this range yet."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No focus time linked to a Task in this range yet."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No focus time linked to a Habit in this range yet."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Daily focus" })).not.toBeInTheDocument();
  });
});

describe("Navigation", () => {
  it("returns to the timer screen", async () => {
    installFakeApi();
    render(<App />);
    await openFocusStats();

    fireEvent.click(screen.getByRole("button", { name: "Back to timer" }));

    expect(await screen.findByRole("heading", { name: "Focus" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  });
});

describe("Session history", () => {
  it("lists persisted sessions newest first with duration and link names", async () => {
    const task = fakeTask("Write report");
    installFakeApi({
      tasks: [task],
      focusSessions: [
        fakeFocusSession({
          started_at: "2026-07-03T08:00:00Z",
          ended_at: "2026-07-03T08:25:00Z",
          note: "morning",
        }),
        fakeFocusSession({
          mode: "pomo",
          started_at: "2026-07-03T10:00:00Z",
          ended_at: "2026-07-03T10:30:00Z",
          pause_seconds: 300,
          task_id: task.id,
        }),
      ],
    });
    render(<App />);
    await openFocusStats();

    const history = await screen.findByRole("list", { name: "Focus Sessions" });
    const rows = within(history).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("pomo");
    expect(rows[0]).toHaveTextContent("25 min");
    expect(rows[0]).toHaveTextContent("Write report");
    expect(rows[1]).toHaveTextContent("stopwatch");
    expect(rows[1]).toHaveTextContent("morning");
  });

  it("shows an empty state with no recorded sessions", async () => {
    installFakeApi();
    render(<App />);
    await openFocusStats();

    expect(await screen.findByText("No Focus Sessions recorded yet.")).toBeInTheDocument();
  });

  it("adds a past session manually", async () => {
    const api = installFakeApi();
    render(<App />);
    await openFocusStats();

    fireEvent.click(screen.getByRole("button", { name: "Add session" }));
    fireEvent.change(screen.getByLabelText("Started"), {
      target: { value: "2026-07-02T09:00" },
    });
    fireEvent.change(screen.getByLabelText("Ended"), {
      target: { value: "2026-07-02T09:45" },
    });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "backfilled" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.focusSessions).toHaveLength(1));
    const saved = api.focusSessions[0];
    expect(saved?.note).toBe("backfilled");
    const wallSeconds =
      (new Date(saved?.ended_at ?? 0).getTime() - new Date(saved?.started_at ?? 0).getTime()) /
      1000;
    expect(wallSeconds).toBe(2700);
  });

  it("edits a session's note and link retroactively", async () => {
    const habit = fakeHabit("Reading");
    const api = installFakeApi({
      habits: [habit],
      focusSessions: [fakeFocusSession({ note: "before" })],
    });
    render(<App />);
    await openFocusStats();

    fireEvent.click(await screen.findByRole("button", { name: "Edit session" }));
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "after" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Session link" }), {
      target: { value: `habit:${habit.id}` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.focusSessions[0]?.note).toBe("after"));
    expect(api.focusSessions[0]?.habit_id).toBe(habit.id);
    expect(
      api.requests.some(
        (r) =>
          r.method === "PATCH" &&
          r.url === `/api/v1/focus-sessions/${api.focusSessions[0]?.id ?? 0}`,
      ),
    ).toBe(true);
  });

  it("deletes a session", async () => {
    const api = installFakeApi({ focusSessions: [fakeFocusSession()] });
    render(<App />);
    await openFocusStats();

    fireEvent.click(await screen.findByRole("button", { name: "Delete session" }));

    await waitFor(() => expect(api.focusSessions).toHaveLength(0));
  });
});
