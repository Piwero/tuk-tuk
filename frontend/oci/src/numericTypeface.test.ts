import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

/** Numeric metadata is set in the body face with tabular figures; monospace
 * is kept only for things the user types: Quick-Add sigil hints, keyboard
 * shortcut caps and code in Markdown (issue #432). jsdom applies no
 * stylesheet, so the claim is checked against the CSS source. */

const css = [
  "index.css",
  "components/HabitCardStats.css",
  "components/HabitsView.css",
  "components/GoalsView.css",
  "components/FocusStatsPanel.css",
]
  .map((file) => readFileSync(resolve(process.cwd(), "src", file), "utf8"))
  .join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** Innermost `selector { body }` rules; media-query wrappers fall away. */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector = "", body = ""]) => ({
  selectors: selector.split(",").map((s) => s.trim()),
  body,
}));

function bodiesFor(selector: string): string {
  return rules
    .filter((rule) => rule.selectors.includes(selector))
    .map((rule) => rule.body)
    .join("\n");
}

describe("numeric metadata typeface (issue #432)", () => {
  it("keeps monospace only on sigil hints, shortcut caps and Markdown code", () => {
    const mono = rules
      .filter((rule) => /font-family:\s*var\(--font-mono\)/.test(rule.body))
      .flatMap((rule) => rule.selectors);
    expect(mono.sort()).toEqual([
      ".quick-add-sigil-hint",
      ".shortcut-hint kbd",
      ".task-description code",
    ]);
  });

  it.each([
    ".date-chip",
    ".check-progress",
    ".habit-streak-count",
    ".habit-progress",
    ".goal-score",
    ".focus-duration",
    ".focus-chart-value",
    ".nav-count",
  ])("%s uses aligned digits", (selector) => {
    expect(bodiesFor(selector)).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });
});
