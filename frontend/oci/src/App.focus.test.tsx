import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeHabit, fakeTask, installFakeApi } from "./test/fakeApi";

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
  fireEvent.click(within(nav).getByRole("link", { name: "Focus" }));
  await screen.findByRole("heading", { name: "Focus" });
}

async function openHabits(): Promise<void> {
  const nav = await screen.findByRole("navigation", { name: "Views" });
  fireEvent.click(within(nav).getByRole("link", { name: "Habits" }));
  await screen.findByRole("heading", { name: "Habits" });
}

// A running Pomo also shows its clock in the nav badge, so once a run is in
// progress the clock text is scoped to the main pane to stay unambiguous.
function main(): ReturnType<typeof within> {
  return within(screen.getByRole("main"));
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
    expect(main().getByText("00:30")).toBeInTheDocument();

    // Paused time never counts as focus.
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    tick(20_000);
    expect(main().getByText("00:30")).toBeInTheDocument();
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
    // A Pomo finishing offers a break rather than dropping straight back to
    // idle — skipping it returns to idle, keeping the chosen length.
    expect(await screen.findByRole("button", { name: "Skip" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
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

describe("Cancel", () => {
  it("discards a running session without recording it", async () => {
    const api = installFakeApi();
    render(<App />);
    await openFocus();

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    tick(60_000);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // Back to idle at once — nothing was ever posted.
    expect(await screen.findByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(
      api.requests.some((r) => r.method === "POST" && r.url === "/api/v1/focus-sessions"),
    ).toBe(false);
    expect(api.focusSessions).toHaveLength(0);
  });

  it("sits alongside Finish while a session runs", async () => {
    installFakeApi();
    render(<App />);
    await openFocus();

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    expect(screen.getByRole("button", { name: "Finish" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });
});

describe("Distraction-free running view", () => {
  it("hides the Timers presets and config while a session runs", async () => {
    installFakeApi();
    render(<App />);
    await openFocus();

    expect(screen.getByRole("heading", { name: "Timers" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Mode" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    expect(screen.queryByRole("heading", { name: "Timers" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Mode" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Statistics" })).not.toBeInTheDocument();
    // The countdown is still the dominant element.
    expect(main().getByText("25:00")).toBeInTheDocument();
  });
});

describe("Breaks", () => {
  it("offers a configurable break once a Pomo finishes, and runs it", async () => {
    const api = installFakeApi();
    render(<App />);
    await openFocus();

    fireEvent.change(screen.getByRole("spinbutton", { name: "Pomo minutes" }), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Break minutes" }), {
      target: { value: "2" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    tick(60_000);
    await waitFor(() => expect(api.focusSessions).toHaveLength(1));

    // What comes next is stated plainly, using the configured break length.
    expect(await screen.findByText(/Time for a break \(02:00\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start break" }));

    // The break counts down like any other run, but finishing it never
    // records a Focus Session.
    expect(main().getByText("02:00")).toBeInTheDocument();
    tick(120_000);
    await waitFor(() => expect(api.focusSessions).toHaveLength(1));
    expect(
      api.requests.filter((r) => r.method === "POST" && r.url === "/api/v1/focus-sessions"),
    ).toHaveLength(1);
  });

  it("can be skipped, returning straight to idle", async () => {
    installFakeApi();
    render(<App />);
    await openFocus();

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    tick(25 * 60_000);

    fireEvent.click(await screen.findByRole("button", { name: "Skip" }));
    expect(await screen.findByRole("button", { name: "Start" })).toBeInTheDocument();
  });

  it("offers the long break on the fourth Pomo of the streak", async () => {
    const api = installFakeApi();
    render(<App />);
    await openFocus();

    fireEvent.change(screen.getByRole("spinbutton", { name: "Pomo minutes" }), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Long break minutes" }), {
      target: { value: "20" },
    });

    for (let i = 0; i < 3; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Start" }));
      tick(60_000);
      await waitFor(() => expect(api.focusSessions).toHaveLength(i + 1));
      fireEvent.click(await screen.findByRole("button", { name: "Skip" }));
      await screen.findByRole("button", { name: "Start" });
    }

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    tick(60_000);
    await waitFor(() => expect(api.focusSessions).toHaveLength(4));

    expect(await screen.findByText(/Time for a long break \(20:00\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start long break" })).toBeInTheDocument();
  });

  it("does not offer a break after a Stopwatch session", async () => {
    const api = installFakeApi();
    render(<App />);
    await openFocus();

    fireEvent.change(screen.getByRole("combobox", { name: "Mode" }), {
      target: { value: "stopwatch" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    tick(60_000);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(api.focusSessions).toHaveLength(1));
    expect(screen.queryByRole("button", { name: "Start break" })).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Start" })).toBeInTheDocument();
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
    expect(main().getByText("01:30")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    tick(10_000);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    tick(30_000);
    expect(main().getByText("02:00")).toBeInTheDocument();

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

    expect(await main().findByText("22:00")).toBeInTheDocument();
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

    expect(await main().findByText("24:30")).toBeInTheDocument();
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

    expect(await main().findByText("02:00")).toBeInTheDocument();
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

    expect(await main().findByText("24:00")).toBeInTheDocument();
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
    // Back to idle once the offered break is skipped: the stored run is gone.
    fireEvent.click(await screen.findByRole("button", { name: "Skip" }));
    expect(await screen.findByRole("button", { name: "Start" })).toBeInTheDocument();
  });
});

describe("Nav badge", () => {
  it("shows the running countdown next to the brand, from any screen", async () => {
    installFakeApi();
    render(<App />);
    await openFocus();

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    tick(60_000);

    expect(
      screen.getByRole("button", { name: "Focus timer running, 24:00 left" }),
    ).toBeInTheDocument();

    // Still there after navigating away — it isn't part of the Focus screen.
    await openHabits();
    expect(
      screen.getByRole("button", { name: "Focus timer running, 24:00 left" }),
    ).toBeInTheDocument();
  });

  it("shows a paused state distinctly from running", async () => {
    installFakeApi();
    render(<App />);
    await openFocus();

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    const badge = screen.getByRole("button", { name: "Focus timer paused, 25:00 left" });
    expect(badge).toHaveClass("paused");
  });

  it("returns to the timer screen when clicked while running", async () => {
    installFakeApi();
    render(<App />);
    await openFocus();

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await openHabits();

    fireEvent.click(screen.getByRole("button", { name: /Focus timer running/ }));
    expect(await screen.findByRole("heading", { name: "Focus" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("keeps announcing a finished Pomo until the badge is dismissed", async () => {
    const api = installFakeApi();
    render(<App />);
    await openFocus();

    fireEvent.change(screen.getByRole("spinbutton", { name: "Pomo minutes" }), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    tick(60_000);
    await waitFor(() => expect(api.focusSessions).toHaveLength(1));

    // Gone from the Focus screen (a break is offered instead), but the nav
    // still says so.
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Focus timer finished" })).toBeInTheDocument();

    await openHabits();
    expect(screen.getByRole("button", { name: "Focus timer finished" })).toBeInTheDocument();

    // Tapping it clears the notice and returns to the Focus screen.
    fireEvent.click(screen.getByRole("button", { name: "Focus timer finished" }));
    await screen.findByRole("heading", { name: "Focus" });
    expect(screen.queryByRole("button", { name: "Focus timer finished" })).not.toBeInTheDocument();
  });
});

describe("Statistics", () => {
  it("links from the timer screen to its own statistics + history screen", async () => {
    installFakeApi();
    render(<App />);
    await openFocus();

    fireEvent.click(screen.getByRole("link", { name: "Statistics" }));

    expect(await screen.findByRole("heading", { name: "Focus statistics" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to timer" })).toBeInTheDocument();
  });
});
