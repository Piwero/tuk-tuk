import { describe, expect, it } from "vitest";

import { readStylesheets } from "./test/stylesheets";

// jsdom paints nothing, so the "not started" dash is guarded in the CSS source:
// one shared primitive (CONTRIBUTING "Shared styles belong to their shared
// primitive"), sized by tokens and flat (design-system: no hard-coded sizes,
// no gradients).
describe("the Habit 'not started' mark (#543)", () => {
  const css = readStylesheets();

  it("is drawn by one shared rule, sized by tokens", () => {
    const dashes = [...css.matchAll(/([^{}]+)\{[^{}]*var\(--habit-dash-width\)[^{}]*\}/g)];

    expect(dashes.map((match) => match[1]?.trim())).toEqual([".not-started::before"]);
    expect(dashes[0]?.[0]).toContain("height: var(--habit-dash-height)");
  });

  it("is never painted with a gradient", () => {
    const rules = [...css.matchAll(/([^{}]*not-started[^{}]*)\{([^{}]*)\}/g)];

    expect(rules.length).toBeGreaterThan(0);
    expect(rules.filter((rule) => rule[2]?.includes("gradient")).map((rule) => rule[1])).toEqual(
      [],
    );
  });
});
