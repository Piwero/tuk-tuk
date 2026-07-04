import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeHabit, installFakeApi } from "./test/fakeApi";

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
  fireEvent.click(within(nav).getByRole("button", { name: "Habits" }));
  await screen.findByRole("heading", { name: "Habits" });
}

describe("Today's Habits", () => {
  it("opens from the sidebar and queries the local day", async () => {
    const api = installFakeApi();
    render(<App />);

    await openHabits();

    await waitFor(() => {
      expect(
        api.requests.some((r) => r.method === "GET" && r.url === "/api/v1/habits?due=2026-07-03"),
      ).toBe(true);
    });
    expect(
      api.requests.some((r) => r.method === "GET" && r.url === "/api/v1/check-ins?date=2026-07-03"),
    ).toBe(true);
  });

  it("shows exactly the Habits scheduled today, the rest under Other habits", async () => {
    installFakeApi({
      habits: [
        fakeHabit("Meditate"),
        fakeHabit("Review week", { frequency: "FREQ=WEEKLY;BYDAY=MO" }),
        fakeHabit("Gym", { frequency: "FREQ=WEEKLY;TT_TIMES=3" }),
      ],
    });
    render(<App />);

    await openHabits();

    const today = await screen.findByRole("list", { name: "Today's Habits" });
    const names = within(today)
      .getAllByRole("listitem")
      .map((item) => within(item).getByRole("heading").textContent);
    expect(names).toEqual(["Meditate", "Gym"]);

    const other = screen.getByRole("list", { name: "Other habits" });
    expect(within(other).getByText("Review week")).toBeInTheDocument();
  });

  it("checks a Boolean Habit in with one tap and undoes it with another", async () => {
    const api = installFakeApi({ habits: [fakeHabit("Meditate")] });
    render(<App />);
    await openHabits();

    fireEvent.click(await screen.findByRole("button", { name: "Check in Meditate" }));

    await screen.findByRole("button", { name: "Undo check-in Meditate" });
    expect(
      api.requests.some(
        (r) =>
          r.method === "PUT" &&
          r.url === "/api/v1/habits/" + String(api.habits[0]?.id) + "/check-ins/2026-07-03",
      ),
    ).toBe(true);
    expect(api.checkIns).toHaveLength(1);
    expect(api.checkIns[0]?.value).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Undo check-in Meditate" }));

    await screen.findByRole("button", { name: "Check in Meditate" });
    expect(api.checkIns).toHaveLength(0);
  });

  it("re-taps keep one Check-in row per habit and date", async () => {
    const api = installFakeApi({ habits: [fakeHabit("Meditate")] });
    render(<App />);
    await openHabits();

    fireEvent.click(await screen.findByRole("button", { name: "Check in Meditate" }));
    fireEvent.click(await screen.findByRole("button", { name: "Undo check-in Meditate" }));
    fireEvent.click(await screen.findByRole("button", { name: "Check in Meditate" }));

    await screen.findByRole("button", { name: "Undo check-in Meditate" });
    expect(api.checkIns).toHaveLength(1);
  });

  it("accumulates a Numeric Habit by +step and completes at the Goal", async () => {
    const api = installFakeApi({
      habits: [fakeHabit("Drink water", { type: "numeric", goal: 4, step: 2, unit: "glasses" })],
    });
    render(<App />);
    await openHabits();

    expect(await screen.findByText("0 / 4 glasses")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add 2 to Drink water" }));
    expect(await screen.findByText("2 / 4 glasses")).toBeInTheDocument();
    expect(screen.queryByText("— Done")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add 2 to Drink water" }));
    expect(await screen.findByText("4 / 4 glasses")).toBeInTheDocument();
    expect(screen.getByText("— Done")).toBeInTheDocument();

    expect(api.checkIns).toHaveLength(1);
    expect(api.checkIns[0]?.value).toBe(4);
    const puts = api.requests.filter((r) => r.method === "PUT");
    expect(puts.map((r) => r.body)).toEqual([{ value: 2 }, { value: 4 }]);
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
    fireEvent.change(screen.getByRole("spinbutton", { name: "Goal" }), { target: { value: "8" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Step" }), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Unit"), { target: { value: "glasses" } });
    fireEvent.change(screen.getByLabelText("Icon"), { target: { value: "💧" } });
    fireEvent.change(screen.getByLabelText("Encouragement"), {
      target: { value: "Stay hydrated!" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Frequency" }), {
      target: { value: "weekdays" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Repeat on Mon" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Repeat on Fri" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // Friday 2026-07-03 is one of the chosen weekdays, so it lands in today.
    const today = await screen.findByRole("list", { name: "Today's Habits" });
    expect(within(today).getByText("Drink water")).toBeInTheDocument();
    const post = api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/habits");
    expect(post?.body).toEqual({
      name: "Drink water",
      type: "numeric",
      goal: 8,
      step: 2,
      unit: "glasses",
      icon: "💧",
      encouragement: "Stay hydrated!",
      frequency: "FREQ=WEEKLY;BYDAY=MO,FR",
    });
  });

  it("edits a Habit in place", async () => {
    const api = installFakeApi({ habits: [fakeHabit("Meditate")] });
    render(<App />);
    await openHabits();

    fireEvent.click(await screen.findByRole("button", { name: "Edit Meditate" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Sit still" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const today = await screen.findByRole("list", { name: "Today's Habits" });
    await waitFor(() => expect(within(today).getByText("Sit still")).toBeInTheDocument());
    expect(api.habits[0]?.name).toBe("Sit still");
  });

  it("edits a Boolean Habit into a Numeric one with goal, unit and frequency", async () => {
    const api = installFakeApi({ habits: [fakeHabit("Meditate")] });
    render(<App />);
    await openHabits();

    fireEvent.click(await screen.findByRole("button", { name: "Edit Meditate" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Habit type" }), {
      target: { value: "numeric" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Goal" }), {
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

    expect(await screen.findByText("0 / 20 minutes")).toBeInTheDocument();
    const patch = api.requests.find((r) => r.method === "PATCH");
    expect(patch?.body).toMatchObject({
      type: "numeric",
      goal: 20,
      step: 1,
      unit: "minutes",
      frequency: "FREQ=WEEKLY;TT_TIMES=5",
    });
    expect(api.habits[0]?.goal).toBe(20);
  });

  it("deletes a Habit after confirming", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const api = installFakeApi({ habits: [fakeHabit("Meditate")] });
    render(<App />);
    await openHabits();

    fireEvent.click(await screen.findByRole("button", { name: "Delete habit Meditate" }));

    await waitFor(() => expect(screen.queryByText("Meditate")).not.toBeInTheDocument());
    expect(api.habits).toHaveLength(0);
  });
});
