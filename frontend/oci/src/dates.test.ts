import { describe, expect, it } from "vitest";

import { fakeTask } from "./test/fakeApi";
import {
  formatDate,
  formatDateRange,
  formatSchedule,
  fromDayIso,
  isDueToday,
  isSettled,
  rescheduledToDay,
  shortDayLabel,
  taskZonedDate,
  weekdayRecordLabel,
} from "./dates";

// The suite is pinned to TZ=UTC (see vite.config.ts), so any Date built from
// local components (`new Date(y, m, d, h, min)`) reads as that same wall
// clock throughout these tests.

describe("formatDate", () => {
  const date = new Date(2026, 6, 3, 14, 5); // Friday, July 3, 2026, 14:05

  it("renders every named style", () => {
    expect(formatDate(date, "full")).toBe("Friday, July 3, 2026");
    expect(formatDate(date, "month")).toBe("July 2026");
    expect(formatDate(date, "weekday")).toBe("Fri");
    expect(formatDate(date, "weekdayLong")).toBe("Friday");
    expect(formatDate(date, "short")).toBe("Jul 3");
    expect(formatDate(date, "shortEuro")).toBe("03/07/26");
    expect(formatDate(date, "time")).toBe("14:05");
  });

  it("composes 'dateTime' from 'short' and 'time'", () => {
    expect(formatDate(date, "dateTime")).toBe("Jul 3, 14:05");
  });
});

describe("formatDateRange", () => {
  it("joins two dates in the given style with an en dash", () => {
    const range = formatDateRange(fromDayIso("2026-07-06"), fromDayIso("2026-07-08"));
    expect(range).toBe("Jul 6 – Jul 8");
  });

  it("defaults to the 'short' style", () => {
    const range = formatDateRange(fromDayIso("2026-07-06"), fromDayIso("2026-07-08"), "shortEuro");
    expect(range).toBe("06/07/26 – 08/07/26");
  });
});

describe("shortDayLabel and weekdayRecordLabel", () => {
  it("still produce their existing labels, now through formatDate", () => {
    expect(shortDayLabel("2026-07-06")).toBe("Jul 6");
    expect(weekdayRecordLabel("2026-08-10")).toBe("Monday: 10/08/26");
  });
});

describe("formatSchedule", () => {
  it("keeps the timed range's tight dash (no surrounding spaces)", () => {
    const label = formatSchedule({
      start_date: "2026-07-10T14:00:00Z",
      due_date: "2026-07-10T15:30:00Z",
      is_all_day: false,
    });
    expect(label).toBe("Jul 10, 14:00–15:30");
  });

  it("keeps the all-day range's spaced en dash", () => {
    const label = formatSchedule({
      start_date: "2026-07-06T00:00:00Z",
      due_date: "2026-07-08T00:00:00Z",
      is_all_day: true,
    });
    expect(label).toBe("Jul 6 – Jul 8");
  });
});

describe("formatSchedule in a view context", () => {
  // Friday 2026-07-03, local noon (TZ=UTC suite-wide).
  const now = new Date(2026, 6, 3, 12, 0);
  const allDay = (day: string): Parameters<typeof formatSchedule>[0] => ({
    start_date: null,
    due_date: `${day}T00:00:00Z`,
    is_all_day: true,
  });
  const timed = (
    due: string,
    start: string | null = null,
  ): Parameters<typeof formatSchedule>[0] => ({
    start_date: start,
    due_date: due,
    is_all_day: false,
  });

  it.each([
    ["all-day today says nothing", allDay("2026-07-03"), ""],
    ["timed today shows its time", timed("2026-07-03T14:00:00Z"), "14:00"],
    [
      "timed range today shows both ends",
      timed("2026-07-03T15:30:00Z", "2026-07-03T14:00:00Z"),
      "14:00–15:30",
    ],
    ["first minute of today is today", timed("2026-07-03T00:00:00Z"), "00:00"],
    ["last minute of yesterday is yesterday", timed("2026-07-02T23:59:00Z"), "Yesterday"],
    ["all-day yesterday", allDay("2026-07-02"), "Yesterday"],
    ["two days late is a weekday", allDay("2026-07-01"), "Wed"],
    ["six days late is a weekday", allDay("2026-06-27"), "Sat"],
    [
      "a full week late is absolute (a weekday would read as today)",
      allDay("2026-06-26"),
      "Jun 26",
    ],
    ["a future date is a bare day", allDay("2026-07-04"), "Jul 4"],
    ["a timed Task a week late drops its time", timed("2026-06-26T14:00:00Z"), "Jun 26"],
    ["unscheduled has no label", { start_date: null, due_date: null, is_all_day: true }, null],
  ])("today: %s", (_name, task, expected) => {
    expect(formatSchedule(task, "today", now)).toBe(expected);
  });

  it.each([
    ["all-day today is its weekday", allDay("2026-07-03"), "Fri"],
    ["all-day tomorrow", allDay("2026-07-04"), "Sat"],
    ["day six ahead is the last weekday name", allDay("2026-07-09"), "Thu"],
    ["day seven ahead is absolute (a weekday would read as today)", allDay("2026-07-10"), "Jul 10"],
    ["overdue is absolute (a weekday would read as upcoming)", allDay("2026-07-02"), "Jul 2"],
    ["timed keeps its time after the weekday", timed("2026-07-06T09:00:00Z"), "Mon, 09:00"],
    [
      "timed range keeps both ends",
      timed("2026-07-06T10:30:00Z", "2026-07-06T09:00:00Z"),
      "Mon, 09:00–10:30",
    ],
    ["unscheduled has no label", { start_date: null, due_date: null, is_all_day: true }, null],
  ])("week: %s", (_name, task, expected) => {
    expect(formatSchedule(task, "week", now)).toBe(expected);
  });

  it.each([
    [
      "timed range today names the day",
      timed("2026-07-03T11:30:00Z", "2026-07-03T10:00:00Z"),
      "Today, 10:00–11:30",
    ],
    ["all-day today", allDay("2026-07-03"), "Today"],
    ["all-day tomorrow", allDay("2026-07-04"), "Tomorrow"],
    ["timed tomorrow", timed("2026-07-04T09:00:00Z"), "Tomorrow, 09:00"],
    ["timed yesterday", timed("2026-07-02T09:00:00Z"), "Yesterday, 09:00"],
    ["later this week is a weekday", allDay("2026-07-07"), "Tue"],
    ["a week out is absolute", allDay("2026-07-10"), "Jul 10"],
    ["two days late is absolute", allDay("2026-07-01"), "Jul 1"],
    ["unscheduled has no label", { start_date: null, due_date: null, is_all_day: true }, null],
  ])("detail: %s", (_name, task, expected) => {
    expect(formatSchedule(task, "detail", now)).toBe(expected);
  });

  it("keeps a multi-day all-day range absolute in every context", () => {
    const range = {
      start_date: "2026-07-01T00:00:00Z",
      due_date: "2026-07-03T00:00:00Z",
      is_all_day: true,
    };
    expect(formatSchedule(range, "today", now)).toBe("Jul 1 – Jul 3");
    expect(formatSchedule(range, "week", now)).toBe("Jul 1 – Jul 3");
  });

  it("reads day boundaries off the clock passed in", () => {
    const lateNight = new Date(2026, 6, 3, 23, 59);
    const justAfter = new Date(2026, 6, 4, 0, 0);
    expect(formatSchedule(allDay("2026-07-03"), "today", lateNight)).toBe("");
    expect(formatSchedule(allDay("2026-07-03"), "today", justAfter)).toBe("Yesterday");
    expect(formatSchedule(allDay("2026-07-10"), "week", lateNight)).toBe("Jul 10");
    expect(formatSchedule(allDay("2026-07-10"), "week", justAfter)).toBe("Fri");
  });

  it("absolute is the default and matches the original labels", () => {
    expect(formatSchedule(allDay("2026-07-03"))).toBe("Jul 3");
    expect(formatSchedule(allDay("2026-07-03"), "absolute", now)).toBe("Jul 3");
    expect(formatSchedule(timed("2026-07-03T14:00:00Z"), "absolute", now)).toBe("Jul 3, 14:00");
  });
});

describe("taskZonedDate", () => {
  it("reads a non-zero UTC offset (Asia/Tokyo, UTC+9, no DST)", () => {
    const date = taskZonedDate({ time_zone: "Asia/Tokyo" }, "2026-07-10T13:00:00Z");
    expect(formatDate(date, "dateTime")).toBe("Jul 10, 22:00");
  });

  it("reads a null timezone as the browser's own, like an Event would", () => {
    const date = taskZonedDate({ time_zone: null }, "2026-07-10T13:00:00Z");
    expect(formatDate(date, "dateTime")).toBe("Jul 10, 13:00");
  });

  it("crosses a DST boundary correctly (America/New_York springs forward)", () => {
    // 2026-03-08 02:00 America/New_York doesn't exist: clocks jump straight
    // from 01:59 EST (UTC-5) to 03:00 EDT (UTC-4).
    const beforeTransition = taskZonedDate(
      { time_zone: "America/New_York" },
      "2026-03-08T06:59:00Z",
    );
    const afterTransition = taskZonedDate(
      { time_zone: "America/New_York" },
      "2026-03-08T07:01:00Z",
    );
    expect(formatDate(beforeTransition, "time")).toBe("01:59");
    expect(formatDate(afterTransition, "time")).toBe("03:01");
  });
});

describe("isDueToday", () => {
  const now = new Date("2026-08-27T09:00:00Z");

  it("is false for an unscheduled task", () => {
    expect(isDueToday(fakeTask("Someday"), now)).toBe(false);
  });

  it("is true for an all-day task due on the current local day", () => {
    const task = fakeTask("Today", { due_date: "2026-08-27", is_all_day: true });
    expect(isDueToday(task, now)).toBe(true);
  });

  it("is false either side of the current local day", () => {
    const yesterday = fakeTask("Late", { due_date: "2026-08-26", is_all_day: true });
    const tomorrow = fakeTask("Soon", { due_date: "2026-08-28", is_all_day: true });
    expect(isDueToday(yesterday, now)).toBe(false);
    expect(isDueToday(tomorrow, now)).toBe(false);
  });

  it("reads a timed task on the local day its instant falls in", () => {
    const later = fakeTask("Later today", { due_date: "2026-08-27T23:30:00Z" });
    const justOver = fakeTask("Just past midnight", { due_date: "2026-08-28T00:30:00Z" });
    expect(isDueToday(later, now)).toBe(true);
    expect(isDueToday(justOver, now)).toBe(false);
  });

  it("still reads true once completed — the styling caller decides that", () => {
    // Unlike isOverdue, completion isn't this helper's business: TaskRow
    // suppresses the accent on a completed row itself.
    const done = fakeTask("Done", { due_date: "2026-08-27", is_all_day: true, completed: true });
    expect(isDueToday(done, now)).toBe(true);
  });
});

describe("isSettled", () => {
  const now = new Date("2026-08-27T09:00:00Z");

  it("is false exactly seven days past due, true beyond", () => {
    const seven = fakeTask("Week old", { due_date: "2026-08-20", is_all_day: true });
    const eight = fakeTask("Settled", { due_date: "2026-08-19", is_all_day: true });
    expect(isSettled(seven, now)).toBe(false);
    expect(isSettled(eight, now)).toBe(true);
  });

  it("compares whole local days, never elapsed hours", () => {
    const allDay = fakeTask("All-day", { due_date: "2026-08-20", is_all_day: true });
    const timed = fakeTask("Timed", { due_date: "2026-08-20T09:00:00Z" });
    // Seven days and almost eight is still not settled; the state flips at
    // local midnight, never as an hour crosses.
    const almostEight = new Date("2026-08-27T23:59:00Z");
    const eightDays = new Date("2026-08-28T00:00:00Z");
    for (const task of [allDay, timed]) {
      expect(isSettled(task, almostEight)).toBe(false);
      expect(isSettled(task, eightDays)).toBe(true);
    }
  });

  it("reads a timed Task by its local due day where that disagrees with the UTC day", () => {
    // Node honours a runtime TZ switch for the local getters localDayOf
    // reads, so this proves the comparison is local-day based without
    // re-pinning the whole suite. Behind UTC, 00:30 UTC on the 21st is
    // still the 20th locally: under UTC these two instants are 6 and 7 days
    // after the UTC date (both unsettled), but locally they are 7 and 8
    // days after the local date — settled only on the second.
    const previousTz = process.env.TZ;
    process.env.TZ = "Pacific/Midway";
    try {
      const task = fakeTask("Late night", { due_date: "2026-08-21T00:30:00Z" });
      expect(isSettled(task, new Date("2026-08-27T12:00:00Z"))).toBe(false);
      expect(isSettled(task, new Date("2026-08-28T12:00:00Z"))).toBe(true);
    } finally {
      process.env.TZ = previousTz;
    }
  });

  it("is never settled when completed or unscheduled", () => {
    const done = fakeTask("Done", {
      due_date: "2026-07-01",
      is_all_day: true,
      completed: true,
    });
    expect(isSettled(done, now)).toBe(false);
    expect(isSettled(fakeTask("Someday"), now)).toBe(false);
  });
});

describe("rescheduledToDay", () => {
  it("keeps a timed task's local start and due times on the new day", () => {
    const task = fakeTask("Standup", {
      start_date: "2026-08-27T09:00:00Z",
      due_date: "2026-08-27T09:30:00Z",
      is_all_day: false,
    });
    const patch = rescheduledToDay(task, "2026-09-01");
    expect(patch.is_all_day).toBe(false);
    expect(patch.start_date).toBe("2026-09-01T09:00:00.000Z");
    expect(patch.due_date).toBe("2026-09-01T09:30:00.000Z");
  });

  it("leaves an all-day task all-day", () => {
    const task = fakeTask("Review", { due_date: "2026-08-27", is_all_day: true });
    const patch = rescheduledToDay(task, "2026-09-01");
    expect(patch.is_all_day).toBe(true);
    expect(patch.start_date).toBeNull();
    expect(patch.due_date).toBe("2026-09-01T00:00:00Z");
  });

  it("schedules an unscheduled task as all-day on the day", () => {
    const task = fakeTask("Someday", { due_date: null });
    const patch = rescheduledToDay(task, "2026-09-01");
    expect(patch.is_all_day).toBe(true);
    expect(patch.due_date).toBe("2026-09-01T00:00:00Z");
  });
});
