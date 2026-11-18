import { diffDays, formatDate, fromDayIso } from "./dates";
import { goalPace } from "./goalPace";

/** Readable Goal window range, with no ISO dates: "Jul 1, 2026 – Jul 5, 2026". */
export function goalWindowRange(start: string | null, end: string | null): string {
  if (start === null || end === null) return "No window";
  return `${formatDate(fromDayIso(start), "date")} – ${formatDate(fromDayIso(end), "date")}`;
}

/** Readable Goal window: "Jul 1, 2026 – Jul 5, 2026 · 2 days left". */
export function goalWindowLabel(start: string | null, end: string | null, today: string): string {
  const range = goalWindowRange(start, end);
  if (start === null || end === null || end < today) return range;
  const days = diffDays(end, today);
  return `${range} · ${days === 0 ? "Last day" : `${days} ${days === 1 ? "day" : "days"} left`}`;
}

/** Score minus pace in whole percentage points, signed: -25, 0, +3. Null when
 * the Goal is settled or unmeasured — pace only applies to a measured, active Goal. */
export function goalPaceDelta(
  score: number | null,
  start: string | null,
  end: string | null,
  today: string,
): number | null {
  if (score === null) return null;
  const pace = goalPace(start, end, today);
  if (pace === null) return null;
  return Math.round(score * 100) - Math.round(pace * 100);
}

/** The pace verdict as a plain sentence, or null when there is none. */
export function goalPaceVerdict(delta: number | null): string | null {
  if (delta === null) return null;
  if (delta === 0) return "On pace";
  return `${Math.abs(delta)} percentage points ${delta > 0 ? "ahead of" : "behind"} pace`;
}
