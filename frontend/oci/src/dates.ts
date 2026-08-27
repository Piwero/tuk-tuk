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

/** A Task's stored instant, read in the timezone it was scheduled in, as a
 * Date whose wall-clock getters — and so formatDate's output — reflect that
 * zone rather than the runtime's own.
 *
 * This is the Task side of a deliberate asymmetry (see the Entry glossary
 * entry in CONTEXT.md): a Task renders in the timezone it was scheduled in
 * — a commitment the user made — while an Event renders in the *viewer's*
 * own timezone instead, an artefact of whoever organised it (zonedDay and
 * zonedTime's `timeZone: null` case, which reads the browser's, is how an
 * Event asks for that). Do not "fix" this asymmetry into symmetry. */
export function taskZonedDate(task: Pick<Task, "time_zone">, iso: string): Date {
  const [hours = 0, minutes = 0] = zonedTime(iso, task.time_zone).split(":").map(Number);
  const date = fromDayIso(zonedDay(iso, task.time_zone));
  date.setHours(hours, minutes, 0, 0);
  return date;
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

/** Due on the viewer's current local day. Reads the same `dueDay` the Today
 * Smart List and the date groupings do, so "today" means one thing across the
 * app. Purely a display distinction: a task row paints today's date in the
 * accent and every other date in the secondary ink, so the accent means
 * something on a mixed list instead of appearing on every row. */
export function isDueToday(task: Task, now: Date = new Date()): boolean {
  const day = dueDay(task);
  return day !== null && day === localDayOf(now);
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

/** Named styles the app's one date-formatting entry point (formatDate)
 * covers — every render site that used to build its own Intl.DateTimeFormat
 * goes through this instead, so date labels stay consistent and a new one
 * doesn't reinvent a format:
 * - "full": "Friday, July 3, 2026" (calendar Day-view title)
 * - "month": "July 2026" (calendar Month-view title, habit month header)
 * - "weekday": "Mon" (calendar Week-view column header)
 * - "weekdayLong": "Monday" (history row label)
 * - "short": "Jul 6" (compact day label)
 * - "shortEuro": "10/08/26" (history row label)
 * - "time": "14:00" (24-hour wall clock)
 * - "dateTime": "Jul 10, 14:00" — "short" and "time" composed
 */
export type DateStyle =
  "full" | "month" | "weekday" | "weekdayLong" | "short" | "shortEuro" | "time" | "dateTime";

// Fixed locales, deterministic output: en-US for month/weekday names, en-GB
// for the numeric day/month/year order "shortEuro" wants — consistent with
// the app's English-only UI. Revisit with i18n.
const FORMATTERS: { [S in Exclude<DateStyle, "dateTime">]: Intl.DateTimeFormat } = {
  full: new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }),
  month: new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }),
  weekday: new Intl.DateTimeFormat("en-US", { weekday: "short" }),
  weekdayLong: new Intl.DateTimeFormat("en-US", { weekday: "long" }),
  short: new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }),
  shortEuro: new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }),
  time: new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }),
};

/** A Date rendered in a named style — the app's one formatting function. */
export function formatDate(date: Date, style: DateStyle): string {
  if (style === "dateTime") {
    return `${formatDate(date, "short")}, ${formatDate(date, "time")}`;
  }
  return FORMATTERS[style].format(date);
}

/** Two dates in the same style, joined as a range: "Jul 6 – Jul 8". */
export function formatDateRange(start: Date, end: Date, style: DateStyle = "short"): string {
  return `${formatDate(start, style)} – ${formatDate(end, style)}`;
}

/** A short deterministic day label: "Jul 6". */
export function shortDayLabel(dayIso: string): string {
  return formatDate(fromDayIso(dayIso), "short");
}

/** A weekday-led record label for history rows: "Monday: 10/08/26". */
export function weekdayRecordLabel(dayIso: string): string {
  const date = fromDayIso(dayIso);
  return `${formatDate(date, "weekdayLong")}: ${formatDate(date, "shortEuro")}`;
}

/** The minimal schedule shape formatSchedule needs — a Task has it
 * directly; an Event (issue #110) satisfies it too, since both render in
 * the same wall-clock convention when no explicit timezone applies. */
type Scheduled = Pick<Task, "start_date" | "due_date" | "is_all_day">;

/** A compact human label: "Jul 6", "Jul 6 – Jul 8", "Jul 10, 14:00–15:30". */
export function formatSchedule(task: Scheduled): string | null {
  if (task.due_date === null) {
    return null;
  }
  if (task.is_all_day) {
    const due = task.due_date.slice(0, 10);
    const start = task.start_date?.slice(0, 10) ?? null;
    return start === null || start === due
      ? shortDayLabel(due)
      : formatDateRange(fromDayIso(start), fromDayIso(due));
  }
  const due = new Date(task.due_date);
  if (task.start_date === null) {
    return formatDate(due, "dateTime");
  }
  return `${formatDate(due, "short")}, ${formatDate(new Date(task.start_date), "time")}–${formatDate(due, "time")}`;
}
