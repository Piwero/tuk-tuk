import { fetchFocusStats, type FocusDayTotal, type FocusStats } from "./api";
import { addDays, browserTimeZone, diffDays } from "./dates";

/** "45 min", "1 h 45 min" — Focus totals, shared by Focus and the Day rail. */
export function formatFocusTotal(seconds: number): string {
  const total = Math.round(seconds / 60);
  const hours = Math.floor(total / 60);
  return hours > 0 ? `${hours} h ${total % 60} min` : `${total} min`;
}

/** The stage's "Pomo N of 4": the Pomo the cycle is on, given how many Pomos
 * finished in a row. After the fourth it starts again at 1. Shared by Focus
 * and the Day rail's Focus card so the two never disagree. */
export function pomoOfCycle(pomoStreak: number): string {
  return `Pomo ${(pomoStreak % 4) + 1} of 4`;
}

/** Focus statistics over [start, end] in the browser's time zone — the one
 * read behind Focus, its statistics screen and the Day rail. */
export function loadFocusStats(start: string, end: string): Promise<FocusStats> {
  return fetchFocusStats(start, end, browserTimeZone());
}

/** Per-day totals over [start, end], every day present (0 when none). */
export async function loadFocusDays(start: string, end: string): Promise<FocusDayTotal[]> {
  const stats = await loadFocusStats(start, end);
  return Array.from({ length: diffDays(end, start) + 1 }, (_, i) => {
    const date = addDays(start, i);
    return { date, seconds: stats.days.find((day) => day.date === date)?.seconds ?? 0 };
  });
}
