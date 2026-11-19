import { describe, expect, it } from "vitest";

import { readStylesheets } from "./test/stylesheets";

/** Numeric metadata is set in the body face with tabular figures; monospace
 * is kept only for things the user types: Quick-Add sigil hints, keyboard
 * shortcut caps, code in Markdown (issue #432) and a temporary password,
 * which its recipient types at first sign-in (#479). jsdom applies no
 * stylesheet, so the claim is checked against the CSS source. */

const css = readStylesheets().replace(/\/\*[\s\S]*?\*\//g, "");

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
  it("keeps monospace only on sigil hints, shortcut caps, Markdown code and temporary passwords", () => {
    const mono = rules
      .filter((rule) => /font-family:\s*var\(--font-mono\)/.test(rule.body))
      .flatMap((rule) => rule.selectors);
    expect(mono.sort()).toEqual([
      ".one-time-password-box code",
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
