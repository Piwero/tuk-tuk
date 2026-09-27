import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

/** `.app` is a three-column grid (sidebar / main / detail panel), so every
 * element rendered as its direct child is a grid item. The mobile-only
 * controls — the tab bar and the Quick-Add button — are hidden on desktop
 * with `display: none` precisely so they claim no track.
 *
 * IconButton wraps its button in a `<span class="icon-button-wrap">` (#270),
 * and a button's own `display: none` cannot hide its wrapper. The wrapper
 * therefore stayed a visible grid item at desktop width: it took the third
 * track, pushing the Task detail panel onto a second implicit row where it
 * sat under the sidebar, invisible — clicking a Task appeared to do nothing.
 * The same rule that hides `.mobile-quick-add` must hide its wrapper, the
 * same way `.drawer-toggle` and `.drawer-close` already do.
 *
 * jsdom applies no stylesheet, so this asserts against the CSS source — the
 * convention contentColumn.test.ts and App.mobileChrome.test.tsx use. */

const css: string = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

/** Ranges of every `@media` block: its query plus the body's span. */
function mediaBlocks(): { query: string; start: number; end: number }[] {
  const found: { query: string; start: number; end: number }[] = [];
  const re = /@media\s+([^{]+)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
    }
    found.push({ query: m[1] as string, start: m.index, end: i });
  }
  return found;
}

const blocks = mediaBlocks();

/** Bodies of every rule matching `pattern`, each tagged with whether it sits
 * inside any `@media` block (i.e. is not an unconditional desktop rule). */
function rules(pattern: RegExp): { body: string; conditional: boolean }[] {
  const found: { body: string; conditional: boolean }[] = [];
  const re = new RegExp(pattern.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const index = m.index;
    found.push({
      body: m[1] as string,
      conditional: blocks.some((block) => index > block.start && index < block.end),
    });
  }
  return found;
}

function hidesAtDesktop(pattern: RegExp): boolean {
  return rules(pattern).some(
    (rule) => !rule.conditional && /display:\s*none/.test(rule.body.split("/*").join("")),
  );
}

describe("`.app` grid items (mobile controls must not claim a track)", () => {
  it("hides the mobile Quick-Add button on desktop", () => {
    expect(hidesAtDesktop(/\.mobile-quick-add\s*\{([^{}]*)\}/)).toBe(true);
  });

  it("hides the IconButton wrapper around it too, so it takes no grid track", () => {
    expect(
      hidesAtDesktop(/\.icon-button-wrap:has\(>\s*\.mobile-quick-add\)\s*\{([^{}]*)\}/),
      "`.icon-button-wrap` wrapping `.mobile-quick-add` is still a visible `.app` grid item on desktop",
    ).toBe(true);
  });

  it("shows the wrapper again at mobile widths, where the button is shown", () => {
    const mobile = rules(/\.icon-button-wrap:has\(>\s*\.mobile-quick-add\)\s*\{([^{}]*)\}/).filter(
      (rule) => rule.conditional,
    );
    expect(mobile.length).toBeGreaterThan(0);
    for (const rule of mobile) {
      expect(rule.body).not.toMatch(/display:\s*none/);
    }
  });

  it("hides the mobile tab bar on desktop (the same trap, already handled)", () => {
    expect(hidesAtDesktop(/\.mobile-tab-bar\s*\{([^{}]*)\}/)).toBe(true);
  });
});
