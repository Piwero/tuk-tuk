/** Pure date math and layout data for the calendar views (Month/Week/Day).
 *
 * Day membership and block times are read in each task's own timezone,
 * mirroring the backend's schedule_days — so a task fetched for the window
 * always renders inside it.
 */

import { type Task, type TaskCreateInput, type TaskPatch } from "./api";
import {
  addDays,
  allDayInstant,
  allDaySchedule,
  browserTimeZone,
  diffDays,
  fromDayIso,
  instantOf,
  localDayOf,
  shiftInstant,
  shortDayLabel,
  zonedDay,
  zonedTime,
} from "./dates";

export type CalendarMode = "month" | "week" | "day";

/** Monday of the week containing the day (WKST=MO, matching recurrence). */
export function startOfWeekDay(dayIso: string): string {
  const weekday = fromDayIso(dayIso).getDay(); // 0 = Sunday
  return addDays(dayIso, -((weekday + 6) % 7));
}

/** The calendar days a task occupies, read in its own timezone, or null when
 * unscheduled — the frontend mirror of the backend's schedule_days. */
export function taskDayWindow(task: Task): [string, string] | null {
  if (task.due_date === null) {
    return null;
  }
  const dayOf = (iso: string): string =>
    task.is_all_day ? iso.slice(0, 10) : zonedDay(iso, task.time_zone);
  const due = dayOf(task.due_date);
  return [task.start_date === null ? due : dayOf(task.start_date), due];
}

/** The tasks whose scheduled days cover the given day. */
export function tasksOn(tasks: Task[], day: string): Task[] {
  return tasks.filter((task) => {
    const window = taskDayWindow(task);
    return window !== null && window[0] <= day && day <= window[1];
  });
}

/** The banners rendered in one all-day lane cell: those whose window starts
 * that day, or started before the visible range (they enter at its first
 * day). Each banner appears in exactly one cell — its drag handle. */
export function laneBanners(tasks: Task[], day: string, firstDay: string): Task[] {
  return tasks.filter((task) => {
    const window = taskDayWindow(task);
    return (
      isBanner(task) &&
      window !== null &&
      window[0] <= day &&
      day <= window[1] &&
      (window[0] === day || (window[0] < firstDay && day === firstDay))
    );
  });
}

/** Banners are all-day or multi-day; anything else renders as a timed block. */
export function isBanner(task: Task): boolean {
  const window = taskDayWindow(task);
  return task.is_all_day || (window !== null && window[0] !== window[1]);
}

/** A timed block's wall-clock [start, end] in the task's timezone, or null
 * when unscheduled. A due-only task shows as the hour ending at its due. */
export function blockSpan(task: Task): [string, string] | null {
  if (task.due_date === null) {
    return null;
  }
  const due = zonedTime(task.due_date, task.time_zone);
  if (task.start_date !== null) {
    return [zonedTime(task.start_date, task.time_zone), due];
  }
  const hourBefore = new Date(new Date(task.due_date).getTime() - 3_600_000);
  return [zonedTime(hourBefore.toISOString(), task.time_zone), due];
}

/** The wall-clock time a timed task happens (its start, or bare due). */
export function entryTime(task: Task): string | null {
  if (task.due_date === null) {
    return null;
  }
  return zonedTime(task.start_date ?? task.due_date, task.time_zone);
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

/** The five weekdays of the anchor's week (Monday–Friday). */
export function weekDays(anchorDay: string): string[] {
  const monday = startOfWeekDay(anchorDay);
  return Array.from({ length: 5 }, (_, index) => addDays(monday, index));
}

/** The inclusive fetch window a view shows (the month view fetches its whole
 * visible grid, so window-edge spans render on the leading/trailing days). */
export function rangeOf(mode: CalendarMode, anchorDay: string): [string, string] {
  if (mode === "month") {
    const grid = monthGridDays(anchorDay);
    return [grid[0] ?? anchorDay, grid[grid.length - 1] ?? anchorDay];
  }
  if (mode === "week") {
    const monday = startOfWeekDay(anchorDay);
    return [monday, addDays(monday, 4)];
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

// Fixed locale, like dates.ts: deterministic labels for an English-only UI.
const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const FULL_DAY = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

/** The toolbar title: "July 2026", "Jun 29 – Jul 5, 2026", "Friday, July 3, 2026". */
export function calendarTitle(mode: CalendarMode, anchorDay: string): string {
  if (mode === "month") {
    return MONTH_YEAR.format(fromDayIso(anchorDay));
  }
  if (mode === "week") {
    const [start, end] = rangeOf("week", anchorDay);
    const year = fromDayIso(end).getFullYear();
    return `${shortDayLabel(start)} – ${shortDayLabel(end)}, ${year}`;
  }
  return FULL_DAY.format(fromDayIso(anchorDay));
}

/** Zero-padded "HH:00" — hour-cell labels and drag-created times. */
export const hourLabel = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;

/** The wall-clock time an hour-cell gesture ends at. Covering the last cell
 * ends at 23:59 — midnight would leak into the next day, which the schedule
 * invariant (a timed task stays within one calendar day) rejects. */
const hourEndTime = (hour: number): string => (hour >= 24 ? "23:59" : hourLabel(hour));

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

/** The create payload for a Week/Day drag: a timed start+due on one day. */
export function timedCreate(
  title: string,
  dayIso: string,
  startHour: number,
  endHour: number,
): TaskCreateInput {
  return {
    title,
    start_date: instantOf(dayIso, hourLabel(startHour)),
    due_date: instantOf(dayIso, hourEndTime(endHour)),
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
    const window = taskDayWindow(task);
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

/** The patch for a block edge dropped on an hour cell, or null when the drop
 * is invalid: another day's column (a timed task stays within one day), or an
 * edge crossing its opposite. Dropping the bottom edge on a cell extends the
 * block through that cell; the top edge starts it there. A due-only block has
 * no start to cross: its due simply moves. The new instant is built in the
 * browser's timezone and the task's own is left untouched — the same thing
 * for every v1 write, which always schedules in the browser's timezone. */
export function resizePatch(
  task: Task,
  edge: "start" | "end",
  dayIso: string,
  hour: number,
): TaskPatch | null {
  if (task.due_date === null || task.is_all_day) {
    return null;
  }
  if (zonedDay(task.due_date, task.time_zone) !== dayIso) {
    return null;
  }
  if (edge === "start") {
    const start = instantOf(dayIso, hourLabel(hour));
    if (new Date(start).getTime() >= new Date(task.due_date).getTime()) {
      return null;
    }
    return { start_date: start };
  }
  const due = instantOf(dayIso, hourEndTime(hour + 1));
  const startMs = task.start_date === null ? null : new Date(task.start_date).getTime();
  if (startMs !== null && new Date(due).getTime() <= startMs) {
    return null;
  }
  return { due_date: due };
}
