import { describe, expect, it } from "vitest";

import {
  buildTimeAxis,
  CALENDAR_NARROW_BREAKPOINT,
  initialScrollMinute,
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

describe("buildTimeAxis", () => {
  it("is the uniform 48px/hour scale when Active hours is off", () => {
    const axis = buildTimeAxis({ enabled: false, start: "09:00", end: "17:00" });
    expect(axis.enabled).toBe(false);
    expect(axis.totalHeight).toBe(24 * 48);
    expect(axis.minuteToY(0)).toBe(0);
    expect(axis.minuteToY(60)).toBe(48);
    expect(axis.minuteToY(720)).toBe(576);
    expect(axis.yToMinute(576)).toBe(720);
    expect(axis.offHoursBands).toHaveLength(0);
  });

  it("null (unloaded) also gives the uniform scale", () => {
    expect(buildTimeAxis(null).totalHeight).toBe(24 * 48);
  });

  it("renders the active band at 96px/hour and the off hours at 24px/hour", () => {
    const axis = buildTimeAxis({ enabled: true, start: "09:00", end: "17:00" });
    expect(axis.enabled).toBe(true);
    // 9 off hours + 8 active + 7 off = 9*24 + 8*96 + 7*24 = 216 + 768 + 168.
    expect(axis.totalHeight).toBe(9 * 24 + 8 * 96 + 7 * 24);
    expect(axis.minuteToY(9 * 60)).toBe(9 * 24);
    expect(axis.minuteToY(10 * 60)).toBe(9 * 24 + 96);
    expect(axis.minuteToY(17 * 60)).toBe(9 * 24 + 8 * 96);
  });

  it("round-trips minute↔y within and across band boundaries", () => {
    const axis = buildTimeAxis({ enabled: true, start: "09:00", end: "17:00" });
    for (const minute of [0, 315, 540, 600, 720, 1020, 1200, 1439]) {
      expect(Math.round(axis.yToMinute(axis.minuteToY(minute)))).toBe(minute);
    }
  });

  it("gives a 15-minute active block its true 24px, not the off-hour floor", () => {
    const axis = buildTimeAxis({ enabled: true, start: "09:00", end: "17:00" });
    expect(axis.blockHeight(10 * 60, 10 * 60 + 15)).toBe(24);
    // A sub-snap active block still clears a readable minimum.
    expect(axis.blockHeight(10 * 60, 10 * 60 + 5)).toBe(24);
  });

  it("floors an off-hour block at a visible 12px, not the 6px its scale implies", () => {
    const axis = buildTimeAxis({ enabled: true, start: "09:00", end: "17:00" });
    expect(axis.blockHeight(6 * 60, 6 * 60 + 5)).toBe(12);
  });

  it("keeps the disabled block-height floor at HOUR_PX / 3", () => {
    const axis = buildTimeAxis({ enabled: false, start: "09:00", end: "17:00" });
    expect(axis.blockHeight(600, 605)).toBe(16);
  });

  it("exposes recessed-tint bands for the off-hours regions", () => {
    const axis = buildTimeAxis({ enabled: true, start: "09:00", end: "17:00" });
    expect(axis.offHoursBands).toEqual([
      { top: 0, height: 9 * 24 },
      { top: 9 * 24 + 8 * 96, height: 7 * 24 },
    ]);
  });

  it("allows a degenerate full-day band (one active segment, no off bands)", () => {
    const axis = buildTimeAxis({ enabled: true, start: "00:00", end: "24:00" });
    expect(axis.totalHeight).toBe(24 * 96);
    expect(axis.offHoursBands).toHaveLength(0);
  });
});

describe("initialScrollMinute", () => {
  it("is the working morning when Active hours is off", () => {
    expect(initialScrollMinute({ enabled: false, start: "09:00", end: "17:00" })).toBe(8 * 60);
    expect(initialScrollMinute(null)).toBe(8 * 60);
  });

  it("is 30 minutes of lead-in above the band start when on", () => {
    expect(initialScrollMinute({ enabled: true, start: "13:00", end: "21:00" })).toBe(12 * 60 + 30);
  });

  it("never scrolls above midnight", () => {
    expect(initialScrollMinute({ enabled: true, start: "00:00", end: "24:00" })).toBe(0);
  });
});
