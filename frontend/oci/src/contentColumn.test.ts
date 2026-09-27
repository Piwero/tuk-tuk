import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

/** Which views fill the content area and which keep the shared reading
 * measure is a pure CSS decision (issue #196). jsdom applies no stylesheet
 * and Vitest strips `.css` imports, so this test reads `index.css` off disk
 * and pins the content-column rule: the dense, columnar surfaces (task
 * list, Search, Kanban) fill the width; the prose surfaces (Settings,
 * Stand-up) stay on `--content-max`. */

const css: string = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

/** The selector list of the first rule whose body is `max-width:
 * var(--content-max)` — the App-layout content-column rule. */
function measureSelectors(): string[] {
  const declMatch = /max-width:\s*var\(--content-max\)/.exec(css);
  expect(declMatch, "content-column declaration not found").not.toBeNull();
  const declIndex = (declMatch as RegExpExecArray).index;
  const before = css.slice(0, declIndex);
  const braceIndex = before.lastIndexOf("{");
  const prevRuleEnd = before.lastIndexOf("}");
  const commentEnd = before.lastIndexOf("*/");
  const selectorStart = Math.max(prevRuleEnd, commentEnd + 1) + 1;
  return before
    .slice(selectorStart, braceIndex)
    .split(",")
    .map((selector) => selector.trim())
    .filter((selector) => selector.length > 0 && !selector.startsWith("/*"));
}

describe("content column (issue #196)", () => {
  const selectors = measureSelectors();

  it("keeps Settings and Stand-up on the reading measure", () => {
    expect(selectors).toContain(".settings-view");
    expect(selectors).toContain(".standup-view");
  });

  it("lets the task list, Search and Kanban fill the content area", () => {
    expect(selectors).not.toContain(".task-groups");
    expect(selectors).not.toContain(".search-view");
    expect(selectors).not.toContain(".search-results");
    expect(selectors).not.toContain(".kanban");
  });

  it("keeps the task list's own chrome aligned with the list", () => {
    // The chrome wrapper — holding the title bar, QuickAdd bar and view
    // controls — fills with the list.
    expect(selectors).not.toContain(".main-chrome");
    expect(selectors).not.toContain(".main-header");
    expect(selectors).not.toContain(".view-controls");
    expect(selectors).not.toContain(".main-chrome > form");
  });

  it("lets the shortcut hint strip span the list it underlines", () => {
    // The strip draws a `border-top` across the foot of the task list, so a
    // narrower cap than the list leaves a rule that stops short of the rows
    // above it — the list's bottom edge reads as broken. It belongs to the
    // list, so it fills with the list.
    const strip = /\.shortcut-hints\s*\{([^{}]*)\}/.exec(css)?.[1] ?? "";
    expect(strip, "`.shortcut-hints` rule not found").not.toBe("");
    expect(strip).not.toMatch(/max-width:\s*var\(--content-max\)/);
  });

  it("never caps `.tasks`, so the aligned-row container query keys off the real width", () => {
    // The aligned single-line row is a container query on `.tasks` with a
    // 620px floor; the wrapped fallback still stands below that. Widening
    // the column must not be undone by a max-width on the list itself.
    expect(selectors).not.toContain(".tasks");
    expect(css).toMatch(/container-type: inline-size/);
    expect(css).toMatch(/@container tasklist \(min-width: 620px\)/);
  });
});
