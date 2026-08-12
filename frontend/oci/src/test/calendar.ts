import { configure, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

/** Pins the clock to Friday 2026-07-03, local noon, so "today" and every view
 * window is deterministic in any timezone. (The suite runs in UTC, so local
 * wall-clock times equal the stored UTC instants.) Also stretches test and
 * query timeouts: calendar renders are slow under full-suite load. */
export function pinCalendarClock(): void {
  vi.setConfig({ testTimeout: 15_000 });
  configure({ asyncUtilTimeout: 5_000 });

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });
}

/** Opens the calendar view, waiting out the (slow) first render in a file. */
export async function openCalendar(): Promise<void> {
  fireEvent.click(await screen.findByRole("link", { name: "Calendar" }));
  await screen.findByRole("heading", { name: "July 2026" }, { timeout: 10_000 });
}

/** Opens the calendar in the Week view (today + 4 days; Friday Jul 3 – Jul 7, 2026). */
export async function openWeek(): Promise<void> {
  await openCalendar();
  fireEvent.click(screen.getByRole("button", { name: "Week" }));
  await screen.findByRole("heading", { name: "Jul 3 – Jul 7, 2026" });
}

/** Opens the calendar in the Day view (Friday, July 3, 2026). */
export async function openDay(): Promise<void> {
  await openCalendar();
  fireEvent.click(screen.getByRole("button", { name: "Day" }));
  await screen.findByRole("heading", { name: "Friday, July 3, 2026" });
}
