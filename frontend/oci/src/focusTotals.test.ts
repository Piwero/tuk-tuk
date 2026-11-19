import { describe, expect, it } from "vitest";

import { pomoOfCycle } from "./focusTotals";

describe("pomoOfCycle", () => {
  it("names the next Pomo of the four-Pomo cycle", () => {
    expect(pomoOfCycle(0)).toBe("Pomo 1 of 4");
    expect(pomoOfCycle(3)).toBe("Pomo 4 of 4");
  });

  it("starts a fresh cycle after the fourth Pomo, then counts on", () => {
    expect(pomoOfCycle(4)).toBe("Pomo 1 of 4");
    expect(pomoOfCycle(5)).toBe("Pomo 2 of 4");
  });
});
