/** Pure date math and layout data for the calendar views (Month/Week/Day).
 *
 * Day membership and block times are read in each task's own timezone,
 * mirroring the backend's schedule_days — so a task fetched for the window
 * always renders inside it.
 */

import {
  type Event,
  type EventAttendee,
  type Task,
  type TaskCreateInput,
  type TaskPatch,
} from "./api";
import {
  addDays,
  allDayInstant,
  allDaySchedule,
  browserTimeZone,
  diffDays,
  formatDate,
  formatDateRange,
  fromDayIso,
  instantOf,
  localDayOf,
  shiftInstant,
  zonedDay,
  zonedTime,
} from "./dates";

export type CalendarMode = "month" | "week" | "day";

/** The minimal time-shape a calendar entry has: enough for the pure layout
 * functions (day-window membership, banner-vs-block, block spans, ordering)
 * to place it on the grid, whatever kind of entry it turns out to be. */
export interface EntryTimeShape {
  readonly start_date: string | null;
  readonly due_date: string | null;
  readonly is_all_day: boolean;
  readonly time_zone: string | null;
}

/** A Task occupying calendar space. */
export interface TaskEntry {
  readonly kind: "task";
  readonly task: Task;
}

/** A read-only Google Calendar Event occupying calendar space (issue #107).
 * Never draggable, resizable, or completable — every mutating path in this
 * module takes a Task, never an Entry, so nothing here can even attempt to
 * write to one. */
export interface EventEntry {
  readonly kind: "event";
  readonly event: Event;
}

/** Anything that can occupy calendar space in Month/Week/Day. Every mutating
 * path (create/move/resize/patch) takes a Task directly rather than an
 * Entry, so the type system — not reviewer vigilance — keeps a write from
 * ever targeting an unwritable arm (an Event has none). */
export type Entry = TaskEntry | EventEntry;

/** The only place a TaskEntry gets built, so every future arm gets a
 * construction site just like it. */
export function taskEntry(task: Task): TaskEntry {
  return { kind: "task", task };
}

/** The only place an EventEntry gets built. */
export function eventEntry(event: Event): EventEntry {
  return { kind: "event", event };
}

/** An entry's minimal time-shape, regardless of kind. An Event carries no
 * timezone of its own on the wire — `time_zone: null` reads it in the
 * *viewer's* timezone (see zonedDay/zonedTime), deliberately asymmetric
 * with a Task, which renders in the timezone it was scheduled in. */
export function entryTimeShape(entry: Entry): EntryTimeShape {
  switch (entry.kind) {
    case "task":
      return entry.task;
    case "event":
      return { ...entry.event, time_zone: null };
  }
}

/** Monday of the week containing the day (WKST=MO, matching recurrence). */
export function startOfWeekDay(dayIso: string): string {
  const weekday = fromDayIso(dayIso).getDay(); // 0 = Sunday
  return addDays(dayIso, -((weekday + 6) % 7));
}

/** The calendar days an entry occupies, read in its own timezone, or null
 * when unscheduled — the frontend mirror of the backend's schedule_days. */
export function entryDayWindow(entry: EntryTimeShape): [string, string] | null {
  if (entry.due_date === null) {
    return null;
  }
  const dayOf = (iso: string): string =>
    entry.is_all_day ? iso.slice(0, 10) : zonedDay(iso, entry.time_zone);
  const due = dayOf(entry.due_date);
  return [entry.start_date === null ? due : dayOf(entry.start_date), due];
}

/** The entries whose scheduled days cover the given day. */
export function entriesOn(entries: Entry[], day: string): Entry[] {
  return entries.filter((entry) => {
    const window = entryDayWindow(entryTimeShape(entry));
    return window !== null && window[0] <= day && day <= window[1];
  });
}

/** The banners rendered in one all-day lane cell: those whose window starts
 * that day, or started before the visible range (they enter at its first
 * day). Each banner appears in exactly one cell — its drag handle. */
export function laneBanners(entries: Entry[], day: string, firstDay: string): Entry[] {
  return entries.filter((entry) => {
    const shape = entryTimeShape(entry);
    const window = entryDayWindow(shape);
    return (
      isBanner(shape) &&
      window !== null &&
      window[0] <= day &&
      day <= window[1] &&
      (window[0] === day || (window[0] < firstDay && day === firstDay))
    );
  });
}

/** Banners are all-day entries. A timed entry whose window spans more than
 * one day — only reachable by an Event; the schedule invariant keeps a
 * timed Task inside one calendar day — renders as a clipped segment in
 * each day's column instead (see blockSegment), not a banner. */
export function isBanner(entry: EntryTimeShape): boolean {
  return entry.is_all_day;
}

/** A timed block's wall-clock [start, end] in the entry's timezone, or null
 * when unscheduled. A due-only entry shows as the hour ending at its due. */
export function blockSpan(entry: EntryTimeShape): [string, string] | null {
  if (entry.due_date === null) {
    return null;
  }
  const due = zonedTime(entry.due_date, entry.time_zone);
  if (entry.start_date !== null) {
    return [zonedTime(entry.start_date, entry.time_zone), due];
  }
  const hourBefore = new Date(new Date(entry.due_date).getTime() - 3_600_000);
  return [zonedTime(hourBefore.toISOString(), entry.time_zone), due];
}

/** The wall-clock time a timed entry happens (its start, or bare due). */
export function entryTime(entry: EntryTimeShape): string | null {
  if (entry.due_date === null) {
    return null;
  }
  return zonedTime(entry.start_date ?? entry.due_date, entry.time_zone);
}

/** The Monday-first grid of days covering the anchor's month. */
export function monthGridDays(anchorDay: string): string[] {
  const [year = 0, month = 1] = anchorDay.split("-").map(Number);
  const first = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
  const lastDate = new Date(year, month, 0); // day 0 of next month = last of this
  const gridStart = startOfWeekDay(first);
  const gridEnd = addDays(startOfWeekDay(localDayOf(lastDate)), 6);
  const days: string[] = [];
  for (let day = gridStart; day <= gridEnd; day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
}

/** The five days starting from the anchor day (today + 4 more days). */
export function weekDays(anchorDay: string): string[] {
  return Array.from({ length: 5 }, (_, index) => addDays(anchorDay, index));
}

/** The inclusive fetch window a view shows (the month view fetches its whole
 * visible grid, so window-edge spans render on the leading/trailing days). */
export function rangeOf(mode: CalendarMode, anchorDay: string): [string, string] {
  if (mode === "month") {
    const grid = monthGridDays(anchorDay);
    return [grid[0] ?? anchorDay, grid[grid.length - 1] ?? anchorDay];
  }
  if (mode === "week") {
    return [anchorDay, addDays(anchorDay, 4)];
  }
  return [anchorDay, anchorDay];
}

/** The previous/next anchor for a view (delta of -1 or 1). */
export function shiftAnchor(mode: CalendarMode, anchorDay: string, delta: number): string {
  if (mode === "month") {
    const [year = 0, month = 1] = anchorDay.split("-").map(Number);
    return localDayOf(new Date(year, month - 1 + delta, 1));
  }
  return addDays(anchorDay, mode === "week" ? 7 * delta : delta);
}

/** The toolbar title: "July 2026", "Jun 29 – Jul 5, 2026", "Friday, July 3, 2026". */
export function calendarTitle(mode: CalendarMode, anchorDay: string): string {
  if (mode === "month") {
    return formatDate(fromDayIso(anchorDay), "month");
  }
  if (mode === "week") {
    const [start, end] = rangeOf("week", anchorDay);
    const year = fromDayIso(end).getFullYear();
    return `${formatDateRange(fromDayIso(start), fromDayIso(end))}, ${year}`;
  }
  return formatDate(fromDayIso(anchorDay), "full");
}

/** Zero-padded "HH:00" — hour-cell labels and drag-created times. */
export const hourLabel = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;

/** Resize snap granularity: quarter-hour, the common calendar convention. */
export const SNAP_MINUTES = 15;

/** Minutes since midnight of an "HH:MM" wall-clock label. */
export const timeMinutes = (time: string): number =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

/** The "HH:MM" label of a minute of the day. Minute 1440 renders as 23:59 —
 * midnight would leak into the next day, which the schedule invariant (a
 * timed task stays within one calendar day) rejects. */
export function minuteLabel(minute: number): string {
  if (minute >= 1440) {
    return "23:59";
  }
  const hours = String(Math.floor(minute / 60)).padStart(2, "0");
  return `${hours}:${String(minute % 60).padStart(2, "0")}`;
}

/** A timed block's [start, end] as minutes of its day, or null when unscheduled. */
export function blockMinutes(entry: EntryTimeShape): [number, number] | null {
  const span = blockSpan(entry);
  return span === null ? null : [timeMinutes(span[0]), timeMinutes(span[1])];
}

/** One day's clipped view of a timed block: its [start, end] minutes for
 * that day, and whether the true block continues past that day's start/end
 * boundary — set whenever the entry's window spans more than one day, which
 * is only reachable by an Event (the Task schedule invariant keeps a timed
 * Task inside one calendar day). */
export interface BlockSegment {
  readonly minutes: [number, number];
  readonly continuesBefore: boolean;
  readonly continuesAfter: boolean;
}

/** A timed block's clipped view for one day of its window, or null when
 * unscheduled or the day isn't in its window. A multi-day window clips: its
 * first day ends at 1440, its last day begins at 0, and any day strictly
 * between spans the full day. A single-day window is unaffected — its
 * minutes are identical to blockMinutes and neither flag is set. */
export function blockSegment(entry: EntryTimeShape, day: string): BlockSegment | null {
  const window = entryDayWindow(entry);
  const minutes = blockMinutes(entry);
  if (window === null || minutes === null || day < window[0] || day > window[1]) {
    return null;
  }
  const start = day === window[0] ? minutes[0] : 0;
  const end = day === window[1] ? minutes[1] : 1440;
  return {
    minutes: [start, end],
    continuesBefore: day !== window[0],
    continuesAfter: day !== window[1],
  };
}

/** Where a dragged block edge lands: snapped to the grid and clamped so the
 * block keeps at least one snap step and stays within its day. */
export function draggedEdgeMinute(
  edge: "start" | "end",
  baseMinute: number,
  deltaMinutes: number,
  otherEdgeMinute: number,
): number {
  const snapped = Math.round((baseMinute + deltaMinutes) / SNAP_MINUTES) * SNAP_MINUTES;
  if (edge === "start") {
    return Math.max(0, Math.min(snapped, otherEdgeMinute - SNAP_MINUTES));
  }
  return Math.min(1440, Math.max(snapped, otherEdgeMinute + SNAP_MINUTES));
}

/** The last instant a timed task may end and still stay within its day. */
const dayEnd = (dayIso: string): number => new Date(instantOf(dayIso, "23:59")).getTime();

/** The create payload for a Month-cell click: an all-day task on that day. */
export function allDayCreate(title: string, dayIso: string): TaskCreateInput {
  return {
    title,
    due_date: allDayInstant(dayIso),
    is_all_day: true,
    time_zone: browserTimeZone(),
  };
}

/** The create payload for a Week/Day drag, or an edited timeframe in the
 * create-task dialog: a timed start+due on one day, given as minutes since
 * midnight. */
export function timedCreate(
  title: string,
  dayIso: string,
  startMinute: number,
  endMinute: number,
): TaskCreateInput {
  return {
    title,
    start_date: instantOf(dayIso, minuteLabel(startMinute)),
    due_date: instantOf(dayIso, minuteLabel(endMinute)),
    is_all_day: false,
    time_zone: browserTimeZone(),
  };
}

/** The schedule patch for a task dropped on a calendar cell (hour is null on
 * a Month cell).
 *
 * A dated task moves. A Month drop shifts its whole window so it starts on
 * the target day — span and timezone preserved, times shifted by exact
 * 24-hour days (across a DST transition the wall-clock hour drifts). An hour
 * drop restarts it at that cell in the browser's timezone (duration
 * preserved, capped at 23:59 to stay within the day; an all-day task becomes
 * a one-hour block). An undated task gains a schedule: all-day on that day,
 * or a one-hour block at that hour. */
export function dropPatch(task: Task, dayIso: string, hour: number | null): TaskPatch {
  if (hour === null) {
    const window = entryDayWindow(task);
    if (window === null || task.due_date === null) {
      // Undated (both facts restate it): gains an all-day schedule that day.
      return allDaySchedule(null, dayIso);
    }
    const days = diffDays(dayIso, window[0]);
    if (task.is_all_day) {
      return {
        start_date:
          task.start_date === null
            ? undefined
            : allDayInstant(addDays(task.start_date.slice(0, 10), days)),
        due_date: allDayInstant(addDays(task.due_date.slice(0, 10), days)),
      };
    }
    return {
      start_date: task.start_date === null ? undefined : shiftInstant(task.start_date, days),
      due_date: shiftInstant(task.due_date, days),
    };
  }
  const duration =
    task.start_date !== null && task.due_date !== null && !task.is_all_day
      ? new Date(task.due_date).getTime() - new Date(task.start_date).getTime()
      : 3_600_000;
  const start = new Date(instantOf(dayIso, hourLabel(hour)));
  const due = new Date(Math.min(start.getTime() + duration, dayEnd(dayIso)));
  return {
    start_date: start.toISOString(),
    due_date: due.toISOString(),
    is_all_day: false,
    time_zone: browserTimeZone(),
  };
}

/** The patch for a block edge released at a minute of its day column, or null
 * when the resize is invalid: an edge crossing its opposite in absolute time
 * (possible when the task's timezone differs from the browser's). A due-only
 * block has no start to cross: its due simply moves. The new instant is built
 * in the browser's timezone and the task's own is left untouched — the same
 * thing for every v1 write, which always schedules in the browser's timezone. */
export function resizePatch(
  task: Task,
  edge: "start" | "end",
  dayIso: string,
  minute: number,
): TaskPatch | null {
  if (task.due_date === null || task.is_all_day) {
    return null;
  }
  if (edge === "start") {
    const start = instantOf(dayIso, minuteLabel(minute));
    if (new Date(start).getTime() >= new Date(task.due_date).getTime()) {
      return null;
    }
    return { start_date: start };
  }
  const due = instantOf(dayIso, minuteLabel(minute));
  const startMs = task.start_date === null ? null : new Date(task.start_date).getTime();
  if (startMs !== null && new Date(due).getTime() <= startMs) {
    return null;
  }
  return { due_date: due };
}

/** An Event's people for the detail popover (issue #110): the organiser
 * first (deduplicated, since Google often lists them in `attendees` too),
 * then everyone else. Empty when the Event has neither. */
export function eventAttendees(event: Event): EventAttendee[] {
  if (event.organizer === null) {
    return event.attendees;
  }
  const organizer = event.organizer;
  return [organizer, ...event.attendees.filter((attendee) => attendee.email !== organizer.email)];
}
