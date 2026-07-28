/** Task-schedule helpers: payload builders, overdue math, display formatting.
 *
 * Wire convention (mirrors the backend): datetimes are UTC instants with a
 * Z suffix; all-day values are date-only semantics stored at T00:00:00Z, so
 * their calendar day is read from the string, never through the local clock.
 */

import { type Task, type TaskCreateInput, type TaskPatch } from "./api";

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
export function fromDayIso(dayIso: string): Date {
  const [year = 0, month = 1, day = 1] = dayIso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Date-only day arithmetic, immune to DST because it never touches the clock. */
export function addDays(dayIso: string, days: number): string {
  const date = fromDayIso(dayIso);
  date.setDate(date.getDate() + days);
  return localDayOf(date);
}

const MS_PER_DAY = 86_400_000;

/** Whole days from one YYYY-MM-DD to another (positive when `to` is later). */
export function diffDays(to: string, from: string): number {
  return Math.round((fromDayIso(to).getTime() - fromDayIso(from).getTime()) / MS_PER_DAY);
}

/** An instant shifted by exact 24-hour days, as the wire's UTC string. */
export function shiftInstant(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * MS_PER_DAY).toISOString();
}

/** Quick pick "Next Week": the Monday after the given day. */
export function nextMonday(dayIso: string): string {
  const weekday = fromDayIso(dayIso).getDay(); // 0 = Sunday
  return addDays(dayIso, (8 - weekday) % 7 || 7);
}

export const allDayInstant = (dayIso: string): string => `${dayIso}T00:00:00Z`;

// Fixed locales, deterministic output: en-CA renders YYYY-MM-DD, en-GB HH:mm.
const zonedDayFormats = new Map<string, Intl.DateTimeFormat>();
const zonedTimeFormats = new Map<string, Intl.DateTimeFormat>();

/** The calendar day of an instant, read in the given IANA timezone (the
 * browser's when null) — the frontend mirror of the backend's day reading. */
export function zonedDay(iso: string, timeZone: string | null): string {
  const key = timeZone ?? "";
  let format = zonedDayFormats.get(key);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone ?? undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    zonedDayFormats.set(key, format);
  }
  return format.format(new Date(iso));
}

/** The wall-clock HH:MM of an instant in the given IANA timezone. */
export function zonedTime(iso: string, timeZone: string | null): string {
  const key = timeZone ?? "";
  let format = zonedTimeFormats.get(key);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-GB", {
      timeZone: timeZone ?? undefined,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    zonedTimeFormats.set(key, format);
  }
  return format.format(new Date(iso));
}

/** The UTC instant of a local wall-clock time (HH:MM) on a local day. */
export function instantOf(dayIso: string, time: string): string {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  const date = fromDayIso(dayIso);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

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
  return {
    start_date: startTime === null ? null : instantOf(dayIso, startTime),
    due_date: instantOf(dayIso, dueTime),
    is_all_day: false,
    time_zone: browserTimeZone(),
  };
}

export function clearedSchedule(): TaskPatch {
  return { start_date: null, due_date: null, is_all_day: false, time_zone: null };
}

/** Draft state of the date editor; empty strings mean "not set". */
export interface DateDraft {
  allDay: boolean;
  startDay: string;
  dueDay: string;
  startTime: string;
  dueTime: string;
}

export function emptyDraft(): DateDraft {
  return { allDay: false, startDay: "", dueDay: "", startTime: "", dueTime: "" };
}

/** The draft an existing task prefills the editor with. */
export function draftFrom(task: Task): DateDraft {
  if (task.due_date === null) {
    return { ...emptyDraft(), dueDay: localDayOf(new Date()) };
  }
  if (task.is_all_day) {
    return {
      allDay: true,
      startDay: task.start_date?.slice(0, 10) ?? "",
      dueDay: task.due_date.slice(0, 10),
      startTime: "",
      dueTime: "",
    };
  }
  return {
    allDay: false,
    startDay: "",
    dueDay: localDayOf(new Date(task.due_date)),
    startTime: task.start_date === null ? "" : localTimeOf(new Date(task.start_date)),
    dueTime: localTimeOf(new Date(task.due_date)),
  };
}

/** The schedule a draft describes, or null when it describes none — an unset
 * day, or a start that doesn't precede its due. Callers treat null as "leave
 * the schedule alone", which is what both editors want. */
export function scheduleFromDraft(draft: DateDraft): TaskPatch | null {
  const { allDay, startDay, dueDay, startTime, dueTime } = draft;
  if (dueDay === "") {
    return null;
  }
  if (allDay) {
    if (startDay !== "" && startDay > dueDay) {
      return null;
    }
    return allDaySchedule(startDay === "" || startDay === dueDay ? null : startDay, dueDay);
  }
  // Time is optional: a bare date means the whole day.
  if (dueTime === "") {
    return startTime === "" ? allDaySchedule(null, dueDay) : null;
  }
  if (startTime !== "" && startTime >= dueTime) {
    return null;
  }
  return timedSchedule(dueDay, startTime === "" ? null : startTime, dueTime);
}

/** A schedule narrowed to a create payload: nulls become omissions, because
 * TaskCreate has no "clear it" case — an absent field is already unset. */
export function scheduleForCreate(patch: TaskPatch): Partial<TaskCreateInput> {
  return {
    ...(patch.start_date == null ? {} : { start_date: patch.start_date }),
    ...(patch.due_date == null ? {} : { due_date: patch.due_date }),
    ...(patch.is_all_day === undefined ? {} : { is_all_day: patch.is_all_day }),
    ...(patch.time_zone == null ? {} : { time_zone: patch.time_zone }),
  };
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

/** A short deterministic day label: "Jul 6". */
export function shortDayLabel(dayIso: string): string {
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
      ? shortDayLabel(due)
      : `${shortDayLabel(start)} – ${shortDayLabel(due)}`;
  }
  const due = new Date(task.due_date);
  const day = MONTH_DAY.format(due);
  if (task.start_date === null) {
    return `${day}, ${TIME.format(due)}`;
  }
  return `${day}, ${TIME.format(new Date(task.start_date))}–${TIME.format(due)}`;
}
