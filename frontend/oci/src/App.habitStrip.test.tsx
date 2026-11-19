import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeHabit, installFakeApi } from "./test/fakeApi";

/* jsdom applies no stylesheet: the strip's phone-only display and its sideways
 * scroll are CSS (App.css, 720px block). These tests pin what it holds and writes. */

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 3, 12));
});
afterEach(() => vi.useRealTimers());

async function openToday(): Promise<void> {
  await screen.findByRole("heading", { name: "Today" });
}

const strip = () => screen.findByRole("list", { name: "Today's Habits" });

describe("Today Habit chip strip", () => {
  it("lists only Habits scheduled today with their state", async () => {
    installFakeApi({
      habits: [
        fakeHabit("Meditate", { id: 1 }),
        fakeHabit("Water", { id: 2, type: "numeric", target: 3, step: 1, unit: "glasses" }),
        fakeHabit("Monday only", { frequency: "FREQ=WEEKLY;BYDAY=MO" }),
        fakeHabit("Old", { is_archived: true }),
      ],
      checkIns: [{ id: 1, habit_id: 1, date: "2026-07-03", value: 1 }],
    });
    window.history.replaceState(null, "", "/today");
    render(<App />);
    await openToday();
    const list = await strip();
    const chips = await within(list).findAllByRole("button");
    expect(chips.map((c) => c.getAttribute("aria-label"))).toEqual([
      "Undo Meditate",
      "Add 1 to Water",
    ]);
    expect(chips[0]).toHaveAttribute("aria-pressed", "true");
    expect(chips[1]).toHaveAttribute("aria-pressed", "false");
    expect(within(list).getByText("0/3 glasses")).toBeInTheDocument();
  });

  it("checks in a Boolean Habit and adds to a Numeric Habit", async () => {
    const api = installFakeApi({
      habits: [
        fakeHabit("Meditate", { id: 1 }),
        fakeHabit("Water", { id: 2, type: "numeric", target: 3, step: 1, unit: "glasses" }),
      ],
    });
    window.history.replaceState(null, "", "/today");
    render(<App />);
    await openToday();
    const list = await strip();
    fireEvent.click(await within(list).findByRole("button", { name: "Check in Meditate" }));
    expect(await within(list).findByRole("button", { name: "Undo Meditate" })).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button", { name: "Add 1 to Water" }));
    expect(await within(list).findByText("1/3 glasses")).toBeInTheDocument();
    const puts = api.requests.filter((r) => r.method === "PUT");
    expect(puts.map((r) => [r.url, r.body])).toEqual([
      ["/api/v1/habits/1/check-ins/2026-07-03", { value: 1 }],
      ["/api/v1/habits/2/check-ins/2026-07-03", { value: 1 }],
    ]);
  });

  it("is absent when Habits is disabled", async () => {
    installFakeApi({
      habits: [fakeHabit("Meditate")],
      sectionSettings: { calendar: true, goals: true, habits: false, focus: true, assistant: true },
    });
    window.history.replaceState(null, "", "/today");
    render(<App />);
    await openToday();
    await waitFor(() =>
      expect(screen.queryByRole("list", { name: "Today's Habits" })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "Check in Meditate" })).not.toBeInTheDocument();
  });

  it("is absent when no Habit is scheduled today", async () => {
    const api = installFakeApi({
      habits: [fakeHabit("Monday only", { frequency: "FREQ=WEEKLY;BYDAY=MO" })],
    });
    window.history.replaceState(null, "", "/today");
    render(<App />);
    await openToday();
    await waitFor(() =>
      expect(api.requests.some((r) => r.url.startsWith("/api/v1/check-ins"))).toBe(true),
    );
    await screen.findByText("No Habits scheduled today");
    expect(screen.queryByRole("list", { name: "Today's Habits" })).not.toBeInTheDocument();
  });

  it("is not shown outside Today", async () => {
    installFakeApi({ habits: [fakeHabit("Meditate")] });
    window.history.replaceState(null, "", "/all");
    render(<App />);
    await screen.findByRole("heading", { name: "All" });
    expect(screen.queryByRole("list", { name: "Today's Habits" })).not.toBeInTheDocument();
  });
});
