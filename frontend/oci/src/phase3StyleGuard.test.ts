import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

import { describe, expect, it } from "vitest";

import { readStylesheets } from "./test/stylesheets";

// jsdom paints nothing, so the design-system rules (docs/design-system.md:
// "Flat colors only — no gradients" and "Never hard-code a color, size…")
// are guarded in the CSS source for the ADHD Phase 3 surfaces.
const css = readStylesheets();

function rulesFor(selector: RegExp): string[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => selector.test(match[1] ?? ""))
    .map((match) => match[2] ?? "");
}

function source(name: string): string {
  return readFileSync(resolve(process.cwd(), "src/components", name), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
}

describe("Phase 3 surfaces stay flat", () => {
  it.each([
    ["the Planned work buffer", /\.planned-buffer\b/],
    ["the skipped Habit day", /\.skipped\b/],
  ])("paints %s with no gradient", (_, selector) => {
    const rules = rulesFor(selector);

    expect(rules.length).toBeGreaterThan(0);
    expect(rules.filter((body) => body.includes("gradient"))).toEqual([]);
  });
});

describe("Phase 3 reminder panels size themselves with tokens", () => {
  it.each(["ReminderPanels.css", "DeliveredReminders.css", "QuietHoursDeferred.css"])(
    "%s hard-codes no size beyond a hairline",
    (name) => {
      // Media queries can't read custom properties, so the breakpoint stays.
      const declarations = source(name).replace(/@media[^{]*/g, "");
      const literals = [...declarations.matchAll(/\b(\d+)px\b/g)].map((match) => match[0]);

      expect(literals.filter((px) => px !== "1px")).toEqual([]);
    },
  );
});
