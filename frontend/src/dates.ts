/** Task-schedule helpers: payload builders, overdue math, display formatting.
 *
 * Wire convention (mirrors the backend): datetimes are UTC instants with a
 * Z suffix; all-day values are date-only semantics stored at T00:00:00Z, so
 * their calendar day is read from the string, never through the local clock.
 */

import { type Task, type TaskPatch } from "./api";

/** The IANA timezone the task is scheduled in — v1 always writes the browser's. */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** The local calendar day of a Date as YYYY-MM-DD. */
export function localDayOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The local wall-clock time of a Date as HH:MM, for prefilling time inputs. */
export function localTimeOf(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** Parse YYYY-MM-DD into a local-midnight Date, without any clock math. */
function fromDayIso(dayIso: string): Date {
  const [year = 0, month = 1, day = 1] = dayIso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Date-only day arithmetic, immune to DST because it never touches the clock. */
export function addDays(dayIso: string, days: number): string {
  const date = fromDayIso(dayIso);
  date.setDate(date.getDate() + days);
  return localDayOf(date);
}

/** Quick pick "Next Week": the Monday after the given day. */
export function nextMonday(dayIso: string): string {
  const weekday = fromDayIso(dayIso).getDay(); // 0 = Sunday
  return addDays(dayIso, (8 - weekday) % 7 || 7);
}

const allDayInstant = (dayIso: string): string => `${dayIso}T00:00:00Z`;

/** A schedule patch always replaces the whole schedule, so saves are idempotent. */
export function allDaySchedule(startDay: string | null, dueDay: string): TaskPatch {
  return {
    start_date: startDay === null ? null : allDayInstant(startDay),
    due_date: allDayInstant(dueDay),
    is_all_day: true,
    time_zone: browserTimeZone(),
  };
}

/** A timed duration within one local day; times are HH:MM from a time input. */
export function timedSchedule(
  dayIso: string,
  startTime: string | null,
  dueTime: string,
): TaskPatch {
  const instant = (time: string): string => {
    const [hours = 0, minutes = 0] = time.split(":").map(Number);
    const date = fromDayIso(dayIso);
    date.setHours(hours, minutes, 0, 0);
    return date.toISOString();
  };
  return {
    start_date: startTime === null ? null : instant(startTime),
    due_date: instant(dueTime),
    is_all_day: false,
    time_zone: browserTimeZone(),
  };
}

export function clearedSchedule(): TaskPatch {
  return { start_date: null, due_date: null, is_all_day: false, time_zone: null };
}

/** The local calendar day a task is due, or null when unscheduled. */
export function dueDay(task: Task): string | null {
  if (task.due_date === null) {
    return null;
  }
  return task.is_all_day ? task.due_date.slice(0, 10) : localDayOf(new Date(task.due_date));
}

/** Open tasks past their due date; all-day tasks only after their whole day. */
export function isOverdue(task: Task, now: Date = new Date()): boolean {
  if (task.completed || task.due_date === null) {
    return false;
  }
  if (task.is_all_day) {
    return task.due_date.slice(0, 10) < localDayOf(now);
  }
  return new Date(task.due_date).getTime() < now.getTime();
}

/** The instant a task is due, for date sorting; all-day means local midnight. */
export function dueInstant(task: Task): number | null {
  if (task.due_date === null) {
    return null;
  }
  if (task.is_all_day) {
    return fromDayIso(task.due_date.slice(0, 10)).getTime();
  }
  return new Date(task.due_date).getTime();
}

// Fixed locale: labels are data-like ("Jul 6"), consistent with the app's
// English-only UI, and deterministic under test. Revisit with i18n.
const MONTH_DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const TIME = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatDay(dayIso: string): string {
  return MONTH_DAY.format(fromDayIso(dayIso));
}

/** A compact human label: "Jul 6", "Jul 6 – Jul 8", "Jul 10, 14:00–15:30". */
export function formatSchedule(task: Task): string | null {
  if (task.due_date === null) {
    return null;
  }
  if (task.is_all_day) {
    const due = task.due_date.slice(0, 10);
    const start = task.start_date?.slice(0, 10) ?? null;
    return start === null || start === due
      ? formatDay(due)
      : `${formatDay(start)} – ${formatDay(due)}`;
  }
  const due = new Date(task.due_date);
  const day = MONTH_DAY.format(due);
  if (task.start_date === null) {
    return `${day}, ${TIME.format(due)}`;
  }
  return `${day}, ${TIME.format(new Date(task.start_date))}–${TIME.format(due)}`;
}
