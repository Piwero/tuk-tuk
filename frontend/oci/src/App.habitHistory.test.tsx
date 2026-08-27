import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeHabit, installFakeApi, type FakeApiState } from "./test/fakeApi";

// All tests pin the clock to Friday 2026-07-03, local noon, so "today" is
// deterministic in any timezone.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

async function openHistory(name: string): Promise<void> {
  const nav = await screen.findByRole("navigation", { name: "Views" });
  fireEvent.click(within(nav).getByRole("link", { name: "Habits" }));
  await screen.findByRole("heading", { name: "Habits" });
  fireEvent.click(await screen.findByRole("button", { name: `Actions for ${name}` }));
  fireEvent.click(await screen.findByRole("menuitem", { name: `History ${name}` }));
}

function checkIn(api: FakeApiState, habitId: number, date: string, value = 1): void {
  api.checkIns.push({ id: 9500 + api.checkIns.length, habit_id: habitId, date, value });
}

describe("Habit history", () => {
  it("shows the server-computed Streak, the monthly grid and the yearly heatmap", async () => {
    const api = installFakeApi({ habits: [fakeHabit("Meditate")] });
    const habitId = api.habits[0]?.id ?? 0;
    checkIn(api, habitId, "2026-07-01");
    checkIn(api, habitId, "2026-07-02");
    render(<App />);

    await openHistory("Meditate");

    expect(await screen.findByText("Streak: 2")).toBeInTheDocument();
    expect(screen.getByText("July 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2026-07-01" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "2026-07-03" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    // The yearly heatmap covers all 12 months, intensity-scaled.
    const heatmap = screen.getByRole("img", { name: "Yearly heatmap" });
    expect(heatmap.querySelectorAll(".heatmap-day")).toHaveLength(365);
    expect(heatmap.querySelector('[title="2026-07-01"]')).toHaveClass("level-4");
    expect(heatmap.querySelector('[title="2026-03-15"]')).toHaveClass("level-0");
    expect(
      api.requests.some(
        (r) =>
          r.method === "GET" &&
          r.url === `/api/v1/habits/${habitId}/stats?today=2026-07-03&year=2026`,
      ),
    ).toBe(true);
  });

  it("scales heatmap intensity by value / Goal for Numeric habits", async () => {
    const api = installFakeApi({
      habits: [fakeHabit("Drink water", { type: "numeric", goal: 8, step: 2, unit: "glasses" })],
    });
    const habitId = api.habits[0]?.id ?? 0;
    checkIn(api, habitId, "2026-07-01", 4);
    checkIn(api, habitId, "2026-07-02", 8);
    render(<App />);

    await openHistory("Drink water");

    const heatmap = await screen.findByRole("img", { name: "Yearly heatmap" });
    expect(heatmap.querySelector('[title="2026-07-01"]')).toHaveClass("level-2");
    expect(heatmap.querySelector('[title="2026-07-02"]')).toHaveClass("level-4");
  });

  it("taps a past day to backfill and taps again to clear (Boolean)", async () => {
    const api = installFakeApi({ habits: [fakeHabit("Meditate")] });
    const habitId = api.habits[0]?.id ?? 0;
    render(<App />);

    await openHistory("Meditate");
    fireEvent.click(await screen.findByRole("button", { name: "2026-07-02" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "2026-07-02" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(
      api.requests.some(
        (r) => r.method === "PUT" && r.url === `/api/v1/habits/${habitId}/check-ins/2026-07-02`,
      ),
    ).toBe(true);
    // Yesterday checked in, today graced: the streak is already visible.
    expect(await screen.findByText("Streak: 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "2026-07-02" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "2026-07-02" })).toHaveAttribute(
        "aria-pressed",
        "false",
      ),
    );
    expect(api.checkIns).toHaveLength(0);
  });

  it("accumulates +step on a past day and a tap on a complete day clears it", async () => {
    const api = installFakeApi({
      habits: [fakeHabit("Drink water", { type: "numeric", goal: 4, step: 2, unit: "glasses" })],
    });
    render(<App />);

    await openHistory("Drink water");
    const day = await screen.findByRole("button", { name: "2026-07-01" });

    fireEvent.click(day);
    await waitFor(() => expect(api.checkIns[0]?.value).toBe(2));

    fireEvent.click(day);
    await waitFor(() => expect(api.checkIns[0]?.value).toBe(4));

    fireEvent.click(day);
    await waitFor(() => expect(api.checkIns).toHaveLength(0));
  });

  it("never backfills the future", async () => {
    installFakeApi({ habits: [fakeHabit("Meditate")] });
    render(<App />);

    await openHistory("Meditate");

    expect(await screen.findByRole("button", { name: "2026-07-04" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "2026-07-03" })).toBeEnabled();
  });

  it("steps between months, fetching the right year's heatmap", async () => {
    const api = installFakeApi({ habits: [fakeHabit("Meditate")] });
    const habitId = api.habits[0]?.id ?? 0;
    checkIn(api, habitId, "2025-12-31");
    render(<App />);

    await openHistory("Meditate");
    await screen.findByText("July 2026");

    for (let step = 0; step < 7; step += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    }

    expect(await screen.findByText("December 2025")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2025-12-31" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await waitFor(() =>
      expect(
        api.requests.some(
          (r) =>
            r.method === "GET" &&
            r.url === `/api/v1/habits/${habitId}/stats?today=2026-07-03&year=2025`,
        ),
      ).toBe(true),
    );
  });

  it("keeps history reachable on archived Habits", async () => {
    const api = installFakeApi({
      habits: [fakeHabit("Meditate", { is_archived: true })],
    });
    const habitId = api.habits[0]?.id ?? 0;
    checkIn(api, habitId, "2026-07-02");
    render(<App />);

    await openHistory("Meditate");

    expect(await screen.findByText("Streak: 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2026-07-02" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
