/** Capacity in a planning window (issue #563): how much of the User's chosen
 * band of one day is still free, explained in plain text.
 *
 * Occupied time is the union of timed Event intervals and Planned work plus
 * its Buffer after, each clipped to the window, so any overlap is counted
 * once. All-day Events are named, never counted as busy time. A Task on the
 * day without Planned work is either known but unplanned (it carries the
 * User's duration estimate, which is reported but takes no time in the
 * window, since it has no place in it) or unknown (no estimate): counted,
 * never guessed. Nothing here reads Focus statistics.
 */

import { type Event, type Task } from "./api";
import { formatMinutes, instantOf } from "./dates";

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
   * unplanned estimates, or the unknown ones when they have no estimate. */
  dayTasks: readonly Task[];
}

export interface Capacity {
  windowMinutes: number;
  availableMinutes: number;
  /** Union of timed Events inside the window. */
  eventMinutes: number;
  /** Union of Planned work blocks and their buffers inside the window. */
  plannedMinutes: number;
  /** Day Tasks with an estimate but no Planned work, and their total. */
  unplannedEstimates: number;
  unplannedMinutes: number;
  unknownEstimates: number;
  allDayEvents: string[];
  /** The summary, sentence by sentence. */
  lines: string[];
}

type Interval = [number, number];

function labelInstant(day: string, label: string): number {
  return Date.parse(instantOf(day, label));
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
    `Planning window ${window.start}–${window.end}: ${formatMinutes(availableMinutes)} available of ${formatMinutes(windowMinutes)}.`,
  ];
  if (eventIntervals.length > 0) {
    lines.push(`Events take ${formatMinutes(eventMinutes)}.`);
  }
  if (plannedIntervals.length > 0) {
    lines.push(`Planned work takes ${formatMinutes(plannedMinutes)}, buffers included.`);
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

  const unplanned = input.dayTasks.filter(
    (task) => task.planned_work === null || task.planned_work === undefined,
  );
  const estimated = unplanned.flatMap((task) =>
    task.estimate_minutes == null ? [] : [task.estimate_minutes],
  );
  const unplannedEstimates = estimated.length;
  const unplannedMinutes = estimated.reduce((total, minutes) => total + minutes, 0);
  if (unplannedEstimates === 1) {
    lines.push(
      `1 Task on this day has an estimate of ${formatMinutes(unplannedMinutes)}, not yet planned.`,
    );
  } else if (unplannedEstimates > 1) {
    lines.push(
      `${unplannedEstimates} Tasks on this day have estimates of ${formatMinutes(unplannedMinutes)} in all, not yet planned.`,
    );
  }
  const unknownEstimates = unplanned.length - unplannedEstimates;
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
    unplannedEstimates,
    unplannedMinutes,
    unknownEstimates,
    allDayEvents,
    lines,
  };
}
