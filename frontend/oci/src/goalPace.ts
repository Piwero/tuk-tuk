import { diffDays } from "./dates";

/** Calendar-day progress through a Goal's window, not wall-clock time. */
export function goalPace(start: string | null, end: string | null, today: string): number | null {
  if (start === null || end === null) return null;
  const total = diffDays(end, start);
  if (total <= 0) return today < start ? 0 : 1;
  return Math.max(0, Math.min(1, diffDays(today, start) / total));
}
