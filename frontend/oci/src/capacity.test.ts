import { describe, expect, it } from "vitest";

import { type Event, type Task } from "./api";
import { capacityOf } from "./capacity";

// The suite runs in UTC (vite.config.ts), so local wall-clock times below
// read the same as the Z instants.
const DAY = "2026-11-25";
const WINDOW = { start: "09:00", end: "17:00" };

function event(title: string, start: string, end: string, isAllDay = false): Event {
  return {
    id: `1:${title}`,
    title,
    start_date: start,
    due_date: end,
    is_all_day: isAllDay,
    color: "#000000",
    location: null,
    description: null,
    attendees: [],
    organizer: null,
    html_link: "",
    account_email: "me@example.com",
    calendar_summary: "Work",
    calendar_id: 1,
    google_event_id: title,
  };
}

function timed(title: string, from: string, to: string): Event {
  return event(title, `${DAY}T${from}:00Z`, `${DAY}T${to}:00Z`);
}

let nextId = 1;
function task(
  title: string,
  plan: { start: string; minutes: number; buffer?: number } | null,
): Task {
  const start = plan === null ? null : `${DAY}T${plan.start}:00Z`;
  return {
    id: nextId++,
    title,
    planned_work:
      plan === null || start === null
        ? null
        : {
            start,
            duration_minutes: plan.minutes,
            time_zone: "UTC",
            buffer_minutes: plan.buffer ?? null,
            end: new Date(Date.parse(start) + plan.minutes * 60_000).toISOString(),
          },
  } as Task;
}

function summary(input: Partial<Parameters<typeof capacityOf>[0]>): ReturnType<typeof capacityOf> {
  return capacityOf({
    day: DAY,
    window: WINDOW,
    events: [],
    plannedTasks: [],
    dayTasks: [],
    ...input,
  });
}

describe("capacityOf", () => {
  it("leaves the whole planning window available on an empty day", () => {
    const result = summary({});

    expect(result.windowMinutes).toBe(480);
    expect(result.availableMinutes).toBe(480);
    expect(result.lines).toEqual(["Planning window 09:00–17:00: 8 h available of 8 h."]);
  });

  it("counts overlapping Events once", () => {
    const result = summary({
      events: [timed("Stand-up", "10:00", "11:00"), timed("Review", "10:30", "11:30")],
    });

    expect(result.eventMinutes).toBe(90);
    expect(result.availableMinutes).toBe(390);
    expect(result.lines).toEqual([
      "Planning window 09:00–17:00: 6 h 30 min available of 8 h.",
      "Events take 1 h 30 min.",
      "Overlapping time is counted once.",
    ]);
  });

  it("counts Planned work with its Buffer after, and overlaps with blocks and Events once", () => {
    const result = summary({
      events: [timed("Call", "14:00", "14:30")],
      plannedTasks: [
        task("Draft report", { start: "13:00", minutes: 60, buffer: 15 }),
        task("Reply to mail", { start: "13:30", minutes: 30, buffer: 30 }),
      ],
    });

    expect(result.plannedMinutes).toBe(90);
    expect(result.availableMinutes).toBe(390);
    expect(result.lines).toEqual([
      "Planning window 09:00–17:00: 6 h 30 min available of 8 h.",
      "Events take 30 min.",
      "Planned work takes 1 h 30 min, buffers included.",
      "Overlapping time is counted once.",
    ]);
  });

  it("says nothing about overlap when nothing overlaps", () => {
    const result = summary({
      events: [timed("Call", "09:00", "10:00")],
      plannedTasks: [task("Draft report", { start: "10:00", minutes: 45, buffer: 15 })],
    });

    expect(result.availableMinutes).toBe(360);
    expect(result.lines).not.toContain("Overlapping time is counted once.");
  });

  it("names all-day Events separately and never counts them as busy time", () => {
    const result = summary({
      events: [
        event("Offsite", `${DAY}T00:00:00Z`, `${DAY}T00:00:00Z`, true),
        event("Conference", "2026-11-24T00:00:00Z", "2026-11-26T00:00:00Z", true),
        event("Yesterday's holiday", "2026-11-24T00:00:00Z", "2026-11-24T00:00:00Z", true),
      ],
    });

    expect(result.availableMinutes).toBe(480);
    expect(result.allDayEvents).toEqual(["Offsite", "Conference"]);
    expect(result.lines).toContain("All-day: Offsite, Conference. Not counted as busy time.");
  });

  it("keeps unknown estimates visibly unknown", () => {
    const planned = task("Draft report", { start: "19:00", minutes: 30 });
    const result = summary({
      plannedTasks: [planned],
      dayTasks: [task("Call the bank", null), task("Pay rent", null), planned],
    });

    expect(result.unknownEstimates).toBe(2);
    expect(result.availableMinutes).toBe(480);
    expect(result.lines).toContain(
      "2 Tasks on this day have no estimate, so their time is unknown.",
    );
  });

  it("words a single unknown estimate in the singular", () => {
    const result = summary({ dayTasks: [task("Call the bank", null)] });

    expect(result.lines).toContain("1 Task on this day has no estimate, so its time is unknown.");
  });

  it("clips Events and Planned work to the window and ignores other days", () => {
    const result = summary({
      events: [
        timed("Early call", "08:00", "10:00"),
        event("Late night", "2026-11-24T23:00:00Z", `${DAY}T01:00:00Z`),
        event("Tomorrow", "2026-11-26T10:00:00Z", "2026-11-26T11:00:00Z"),
      ],
      plannedTasks: [
        task("Wrap up", { start: "16:30", minutes: 60 }),
        task("Earlier block", { start: "07:00", minutes: 60, buffer: 30 }),
      ],
    });

    expect(result.eventMinutes).toBe(60);
    expect(result.plannedMinutes).toBe(30);
    expect(result.availableMinutes).toBe(390);
  });

  it("reaches across midnight when the window covers the whole day", () => {
    const result = summary({
      window: { start: "00:00", end: "24:00" },
      events: [event("Night shift", "2026-11-24T22:00:00Z", `${DAY}T02:00:00Z`)],
    });

    expect(result.windowMinutes).toBe(1440);
    expect(result.eventMinutes).toBe(120);
    expect(result.lines[0]).toBe("Planning window 00:00–24:00: 22 h available of 24 h.");
  });
});
