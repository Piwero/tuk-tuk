/** Pure date math and layout data for the calendar views (Month/Week/Day).
 *
 * Day membership and block times are read in each task's own timezone,
 * mirroring the backend's schedule_days — so a task fetched for the window
 * always renders inside it.
 */

import { type Task, type TaskCreateInput } from "./api";
import {
  addDays,
  allDayInstant,
  browserTimeZone,
  fromDayIso,
  instantOf,
  localDayOf,
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

/** The seven days of the anchor's week, Monday first. */
export function weekDays(anchorDay: string): string[] {
  const monday = startOfWeekDay(anchorDay);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
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
    return [monday, addDays(monday, 6)];
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
    due_date: instantOf(dayIso, hourLabel(endHour)),
    is_all_day: false,
    time_zone: browserTimeZone(),
  };
}
