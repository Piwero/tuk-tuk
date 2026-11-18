import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { _resetHintSessionForTests } from "./components/Hint";
import { fakeHabit, installFakeApi } from "./test/fakeApi";

// Pinned so "today" is deterministic in any timezone (#266).
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0));
  _resetHintSessionForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

async function openHabits(): Promise<void> {
  const nav = await screen.findByRole("navigation", { name: "Views" });
  fireEvent.click(within(nav).getByRole("link", { name: "Habits" }));
  await screen.findByRole("heading", { name: "Habits" });
}

describe("Habit card hints (#266)", () => {
  it("shows a strip square's date and status as a visible hint on hover, unchanged from its accessible name", async () => {
    const user = userEvent.setup();
    installFakeApi({ habits: [fakeHabit("Meditate")] });
    render(<App />);
    await openHabits();

    const strip = screen.getByRole("group", { name: "Recent days for Meditate" });
    const today = within(strip).getByRole("button", { name: /not yet checked in/ });
    const name = today.getAttribute("aria-label");
    expect(name).toMatch(/: not yet checked in$/);

    await user.hover(today);
    expect(await screen.findByText(name!)).toBeInTheDocument();
  });

  it("shows the strip hint on keyboard focus, not hover alone", async () => {
    installFakeApi({ habits: [fakeHabit("Meditate")] });
    render(<App />);
    await openHabits();

    const strip = screen.getByRole("group", { name: "Recent days for Meditate" });
    const today = within(strip).getByRole("button", { name: /not yet checked in/ });
    today.focus();
    expect(await screen.findByText(today.getAttribute("aria-label")!)).toBeInTheDocument();
  });

  it("shows a hint on Streak explaining it counts consecutive scheduled days without a miss", async () => {
    const user = userEvent.setup();
    installFakeApi({ habits: [fakeHabit("Meditate")] });
    render(<App />);
    await openHabits();

    await user.hover(await screen.findByText("Streak: 0"));
    expect(
      await screen.findByText(/consecutive scheduled days this Habit has been checked in/),
    ).toBeInTheDocument();
  });

  it("shows a hint on the Habit actions menu glyph", async () => {
    const user = userEvent.setup();
    installFakeApi({ habits: [fakeHabit("Meditate")] });
    render(<App />);
    await openHabits();

    const trigger = screen.getByRole("button", { name: "Actions for Meditate" });
    await user.hover(trigger);
    expect(await screen.findByText("Actions for Meditate")).toBeInTheDocument();
  });
});
