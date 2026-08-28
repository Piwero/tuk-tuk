import { describe, expect, it } from "vitest";

import { fakeTask } from "./test/fakeApi";
import {
  formatDate,
  formatDateRange,
  formatSchedule,
  fromDayIso,
  isDueToday,
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
