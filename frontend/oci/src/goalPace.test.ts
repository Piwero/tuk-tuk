import { describe, expect, it } from "vitest";

import { goalPace } from "./goalPace";

describe("Goal pace", () => {
  it.each([
    ["2026-06-30", 0],
    ["2026-07-01", 0],
    ["2026-07-03", 0.5],
    ["2026-07-05", 1],
    ["2026-07-06", 1],
  ])("on %s is %s", (today, expected) => {
    expect(goalPace("2026-07-01", "2026-07-05", today)).toBe(expected);
  });

  it.each([
    [null, null],
    ["2026-07-01", null],
    [null, "2026-07-05"],
  ])("has no pace without a complete window (%s, %s)", (start, end) =>
    expect(goalPace(start, end, "2026-07-03")).toBeNull(),
  );

  it.each([
    ["2026-07-02", 0],
    ["2026-07-03", 1],
    ["2026-07-04", 1],
  ])("handles a one-day window on %s", (today, expected) =>
    expect(goalPace("2026-07-03", "2026-07-03", today)).toBe(expected),
  );
});
