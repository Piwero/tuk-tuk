import { describe, expect, it } from "vitest";

import {
  CALENDAR_NARROW_BREAKPOINT,
  isNarrowWidth,
  monthGridDays,
  rangeOf,
  shiftAnchor,
  weekDays,
} from "./calendar";

// Friday 2026-07-03 sits in the Monday-aligned week Jun 29 – Jul 5 — the same
// week Month's grid puts it in (the grid's leading days, per the Month view
// test in App.calendar.test.tsx: "The July grid runs Mon Jun 29 – Sun Aug 2").
describe("weekDays", () => {
  it("returns the seven-day Monday-aligned week containing the anchor", () => {
    expect(weekDays("2026-07-03")).toEqual([
      "2026-06-29",
      "2026-06-30",
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
    ]);
  });

  it("starts from the same Monday regardless of which day of the week the anchor is", () => {
    // Monday itself, and the following Sunday, both belong to the same week.
    expect(weekDays("2026-06-29")).toEqual(weekDays("2026-07-03"));
    expect(weekDays("2026-07-05")).toEqual(weekDays("2026-07-03"));
  });

  it("agrees with Month's grid on which dates belong to the anchor's week", () => {
    const anchor = "2026-07-03";
    const grid = monthGridDays(anchor);
    for (const day of weekDays(anchor)) {
      expect(grid).toContain(day);
    }
  });
});

describe("rangeOf in week mode", () => {
  it("spans the full seven-day Monday-aligned week, not a five-day window", () => {
    expect(rangeOf("week", "2026-07-03")).toEqual(["2026-06-29", "2026-07-05"]);
  });
});

describe("shiftAnchor in week mode", () => {
  it("steps by a whole week and lands on the adjacent Monday-aligned week", () => {
    const next = shiftAnchor("week", "2026-07-03", 1);
    expect(weekDays(next)).toEqual([
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
      "2026-07-09",
      "2026-07-10",
      "2026-07-11",
      "2026-07-12",
    ]);

    const previous = shiftAnchor("week", "2026-07-03", -1);
    expect(weekDays(previous)).toEqual([
      "2026-06-22",
      "2026-06-23",
      "2026-06-24",
      "2026-06-25",
      "2026-06-26",
      "2026-06-27",
      "2026-06-28",
    ]);
  });
});

// The Calendar's phone-width cutoff (issue #169): shared with the app
// shell's own off-canvas sidebar breakpoint (index.css's
// `@media (max-width: 720px)`) so the two never disagree about what counts
// as narrow.
describe("isNarrowWidth", () => {
  it("is narrow at and below the breakpoint", () => {
    expect(isNarrowWidth(CALENDAR_NARROW_BREAKPOINT)).toBe(true);
    expect(isNarrowWidth(390)).toBe(true);
    expect(isNarrowWidth(320)).toBe(true);
  });

  it("is not narrow above the breakpoint", () => {
    expect(isNarrowWidth(CALENDAR_NARROW_BREAKPOINT + 1)).toBe(false);
    expect(isNarrowWidth(1024)).toBe(false);
  });
});
