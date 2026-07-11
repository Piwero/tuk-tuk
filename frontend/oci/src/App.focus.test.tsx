import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeFocusSession, fakeHabit, fakeTask, installFakeApi } from "./test/fakeApi";

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

describe("Pomo timer", () => {
  it("counts down an adjustable length with honest pause tracking", async () => {
    const api = installFakeApi();
    render(<App />);
    await openFocus();

    // Default Pomo length: 25 minutes.
    expect(screen.getByText("25:00")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("spinbutton", { name: "Pomo minutes" }), {
      target: { value: "1" },
    });
    expect(screen.getByText("01:00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    tick(30_000);
    expect(screen.getByText("00:30")).toBeInTheDocument();

    // Paused time never counts as focus.
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    tick(20_000);
    expect(screen.getByText("00:30")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));

    // The countdown finishes and the session persists itself.
    tick(30_000);
    await waitFor(() => expect(api.focusSessions).toHaveLength(1));
    const saved = api.focusSessions[0];
    expect(saved?.mode).toBe("pomo");
    expect(saved?.pause_seconds).toBe(20);
    const wallSeconds =
      (new Date(saved?.ended_at ?? 0).getTime() - new Date(saved?.started_at ?? 0).getTime()) /
      1000;
    expect(wallSeconds).toBe(80);
    // Back to idle, keeping the chosen length.
    expect(await screen.findByText("01:00")).toBeInTheDocument();
  });

  it("can finish early, recording the honest shorter period", async () => {
    const api = installFakeApi();
    render(<App />);
    await openFocus();

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    tick(60_000);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(api.focusSessions).toHaveLength(1));
    const saved = api.focusSessions[0];
    expect(saved?.mode).toBe("pomo");
    const wallSeconds =
      (new Date(saved?.ended_at ?? 0).getTime() - new Date(saved?.started_at ?? 0).getTime()) /
      1000;
    expect(wallSeconds).toBe(60);
  });
});

describe("Stopwatch", () => {
  it("counts up and persists on finish", async () => {
    const api = installFakeApi();
    render(<App />);
    await openFocus();

    fireEvent.change(screen.getByRole("combobox", { name: "Mode" }), {
      target: { value: "stopwatch" },
    });
    expect(screen.getByText("00:00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    tick(90_000);
    expect(screen.getByText("01:30")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    tick(10_000);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    tick(30_000);
    expect(screen.getByText("02:00")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(api.focusSessions).toHaveLength(1));
    expect(api.focusSessions[0]?.mode).toBe("stopwatch");
    expect(api.focusSessions[0]?.pause_seconds).toBe(10);
  });
});

describe("Linking", () => {
  it("links the session to a Task chosen before starting", async () => {
    const task = fakeTask("Write report");
    const api = installFakeApi({ tasks: [task] });
    render(<App />);
    await openFocus();

    fireEvent.change(await screen.findByRole("combobox", { name: "Link" }), {
      target: { value: `task:${task.id}` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    tick(60_000);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(api.focusSessions).toHaveLength(1));
    expect(api.focusSessions[0]?.task_id).toBe(task.id);
    expect(api.focusSessions[0]?.habit_id).toBeNull();
  });

  it("links the session to a Habit", async () => {
    const habit = fakeHabit("Reading");
    const api = installFakeApi({ habits: [habit] });
    render(<App />);
    await openFocus();

    fireEvent.change(await screen.findByRole("combobox", { name: "Link" }), {
      target: { value: `habit:${habit.id}` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    tick(60_000);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(api.focusSessions).toHaveLength(1));
    expect(api.focusSessions[0]?.habit_id).toBe(habit.id);
  });

  it("starts a linked Pomo straight from the task row", async () => {
    const task = fakeTask("Write report");
    const api = installFakeApi({ tasks: [task] });
    render(<App />);
    await screen.findByRole("button", { name: "Open details for Write report" });

    fireEvent.click(screen.getByRole("button", { name: "Start Focus for Write report" }));

    expect(await screen.findByRole("heading", { name: "Focus" })).toBeInTheDocument();
    // Already running against the task, no extra tap needed.
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Link" })).toHaveValue(`task:${task.id}`);

    tick(60_000);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(api.focusSessions).toHaveLength(1));
    expect(api.focusSessions[0]?.task_id).toBe(task.id);
    expect(api.focusSessions[0]?.mode).toBe("pomo");
  });
});

describe("Run persistence", () => {
  async function openHabits(): Promise<void> {
    const nav = await screen.findByRole("navigation", { name: "Views" });
    fireEvent.click(within(nav).getByRole("button", { name: "Habits" }));
    await screen.findByRole("heading", { name: "Habits" });
  }

  it("keeps the countdown running across leaving and reopening the Focus view", async () => {
    const task = fakeTask("Write report");
    installFakeApi({ tasks: [task] });
    render(<App />);
    await openFocus();

    fireEvent.change(await screen.findByRole("combobox", { name: "Link" }), {
      target: { value: `task:${task.id}` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    tick(60_000);

    await openHabits();
    tick(120_000); // Time keeps passing while the view is unmounted.
    await openFocus();

    expect(await screen.findByText("22:00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Link" })).toHaveValue(`task:${task.id}`);
  });

  it("keeps a pause frozen while the view is away", async () => {
    installFakeApi();
    render(<App />);
    await openFocus();

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    tick(30_000);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    await openHabits();
    tick(90_000);
    await openFocus();

    expect(await screen.findByText("24:30")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume" })).toBeInTheDocument();
  });

  it("keeps a stopwatch counting across view switches", async () => {
    installFakeApi();
    render(<App />);
    await openFocus();

    fireEvent.change(screen.getByRole("combobox", { name: "Mode" }), {
      target: { value: "stopwatch" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    tick(90_000);

    await openHabits();
    tick(30_000);
    await openFocus();

    expect(await screen.findByText("02:00")).toBeInTheDocument();
  });

  it("restores a running pomo after a full remount, like a page reload", async () => {
    installFakeApi();
    const first = render(<App />);
    await openFocus();

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    tick(60_000);
    first.unmount();

    render(<App />);
    await openFocus();

    expect(await screen.findByText("24:00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("records the honest expiry when a pomo runs out while away", async () => {
    const api = installFakeApi();
    render(<App />);
    await openFocus();

    fireEvent.change(screen.getByRole("spinbutton", { name: "Pomo minutes" }), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    tick(10_000);

    await openHabits();
    tick(300_000); // The pomo expired long before anyone looked.
    await openFocus();

    await waitFor(() => expect(api.focusSessions).toHaveLength(1));
    const saved = api.focusSessions[0];
    const wallSeconds =
      (new Date(saved?.ended_at ?? 0).getTime() - new Date(saved?.started_at ?? 0).getTime()) /
      1000;
    expect(wallSeconds).toBe(60);
    // Back to idle: the stored run is gone.
    expect(await screen.findByRole("button", { name: "Start" })).toBeInTheDocument();
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
    await openFocus();

    const history = await screen.findByRole("list", { name: "Focus Sessions" });
    const rows = within(history).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("pomo");
    expect(rows[0]).toHaveTextContent("25 min");
    expect(rows[0]).toHaveTextContent("Write report");
    expect(rows[1]).toHaveTextContent("stopwatch");
    expect(rows[1]).toHaveTextContent("morning");
  });

  it("adds a past session manually", async () => {
    const api = installFakeApi();
    render(<App />);
    await openFocus();

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
    await openFocus();

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
    await openFocus();

    fireEvent.click(await screen.findByRole("button", { name: "Delete session" }));

    await waitFor(() => expect(api.focusSessions).toHaveLength(0));
  });
});
