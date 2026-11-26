/** Capacity in a planning window (issue #563): how much of the User's chosen
 * band of one day is still free, explained in plain text.
 *
 * Occupied time is the union of timed Event intervals and Planned work plus
 * its Buffer after, each clipped to the window, so any overlap is counted
 * once. All-day Events are named, never counted as busy time. A Task on the
 * day without Planned work has no estimate: it is counted, never guessed.
 * Nothing here reads Focus statistics.
 */

import { type Event, type Task } from "./api";
import { fromDayIso } from "./dates";

const MINUTE_MS = 60_000;

/** The planning window's band, as the "HH:MM" labels the setting stores
 * ("24:00" is the end of the day). */
export interface PlanningBand {
  start: string;
  end: string;
}

export interface CapacityInput {
  /** The local calendar day, YYYY-MM-DD, read in the browser's timezone. */
  day: string;
  window: PlanningBand;
  /** Events from enabled calendars around the day; others are ignored. */
  events: readonly Event[];
  /** Open Tasks that may carry Planned work; blocks off the window are ignored. */
  plannedTasks: readonly Task[];
  /** Open Tasks scheduled on the day: those without Planned work are the
   * unknown estimates. */
  dayTasks: readonly Task[];
}

export interface Capacity {
  windowMinutes: number;
  availableMinutes: number;
  /** Union of timed Events inside the window. */
  eventMinutes: number;
  /** Union of Planned work blocks and their buffers inside the window. */
  plannedMinutes: number;
  unknownEstimates: number;
  allDayEvents: string[];
  /** The summary, sentence by sentence. */
  lines: string[];
}

type Interval = [number, number];

/** "8 h", "1 h 30 min", "45 min". */
export function formatCapacityMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

function labelInstant(day: string, label: string): number {
  const [hours = 0, minutes = 0] = label.split(":").map(Number);
  const date = fromDayIso(day);
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
}

function clip([start, end]: Interval, [from, to]: Interval): Interval | null {
  const clipped: Interval = [Math.max(start, from), Math.min(end, to)];
  return clipped[0] < clipped[1] ? clipped : null;
}

/** Total length of a set of intervals, overlaps counted once. */
function unionMs(intervals: readonly Interval[]): number {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let current: Interval | null = null;
  for (const interval of sorted) {
    if (current === null || interval[0] > current[1]) {
      if (current !== null) total += current[1] - current[0];
      current = [...interval];
    } else {
      current[1] = Math.max(current[1], interval[1]);
    }
  }
  return current === null ? total : total + current[1] - current[0];
}

function sumMs(intervals: readonly Interval[]): number {
  return intervals.reduce((total, [start, end]) => total + end - start, 0);
}

function toMinutes(ms: number): number {
  return Math.round(ms / MINUTE_MS);
}

export function capacityOf(input: CapacityInput): Capacity {
  const { day, window } = input;
  const bounds: Interval = [labelInstant(day, window.start), labelInstant(day, window.end)];
  const windowMs = bounds[1] - bounds[0];

  const eventIntervals = input.events
    .filter((event) => !event.is_all_day)
    .map((event) => clip([Date.parse(event.start_date), Date.parse(event.due_date)], bounds))
    .filter((interval): interval is Interval => interval !== null);

  const plannedIntervals = input.plannedTasks
    .map((task) => task.planned_work)
    .filter((plan) => plan !== null && plan !== undefined)
    .map((plan) => {
      const end = Date.parse(plan.end) + (plan.buffer_minutes ?? 0) * MINUTE_MS;
      return clip([Date.parse(plan.start), end], bounds);
    })
    .filter((interval): interval is Interval => interval !== null);

  const occupied = [...eventIntervals, ...plannedIntervals];
  const eventMs = unionMs(eventIntervals);
  const plannedMs = unionMs(plannedIntervals);
  const occupiedMs = unionMs(occupied);

  const windowMinutes = toMinutes(windowMs);
  const availableMinutes = toMinutes(windowMs - occupiedMs);
  const eventMinutes = toMinutes(eventMs);
  const plannedMinutes = toMinutes(plannedMs);

  const lines = [
    `Planning window ${window.start}–${window.end}: ${formatCapacityMinutes(availableMinutes)} available of ${formatCapacityMinutes(windowMinutes)}.`,
  ];
  if (eventIntervals.length > 0) {
    lines.push(`Events take ${formatCapacityMinutes(eventMinutes)}.`);
  }
  if (plannedIntervals.length > 0) {
    lines.push(`Planned work takes ${formatCapacityMinutes(plannedMinutes)}, buffers included.`);
  }
  if (sumMs(occupied) > occupiedMs) {
    lines.push("Overlapping time is counted once.");
  }

  // An all-day Event's wire days are date-only and inclusive (the adapter
  // already turned Google's exclusive end into the last day it covers).
  const allDayEvents = input.events
    .filter(
      (event) =>
        event.is_all_day &&
        event.start_date.slice(0, 10) <= day &&
        day <= event.due_date.slice(0, 10),
    )
    .map((event) => event.title);
  if (allDayEvents.length > 0) {
    lines.push(`All-day: ${allDayEvents.join(", ")}. Not counted as busy time.`);
  }

  const unknownEstimates = input.dayTasks.filter(
    (task) => task.planned_work === null || task.planned_work === undefined,
  ).length;
  if (unknownEstimates === 1) {
    lines.push("1 Task on this day has no estimate, so its time is unknown.");
  } else if (unknownEstimates > 1) {
    lines.push(`${unknownEstimates} Tasks on this day have no estimate, so their time is unknown.`);
  }

  return {
    windowMinutes,
    availableMinutes,
    eventMinutes,
    plannedMinutes,
    unknownEstimates,
    allDayEvents,
    lines,
  };
}
