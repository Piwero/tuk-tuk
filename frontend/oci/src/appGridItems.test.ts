import { readStylesheets } from "./test/stylesheets";
import { describe, expect, it } from "vitest";

/** `.app` is a three-column grid (sidebar / main / detail panel), so every
 * element rendered as its direct child is a grid item. The mobile-only
 * controls — the tab bar and its More sheet — are hidden on desktop
 * with `display: none` precisely so they claim no track.
 *
 * (An earlier floating Quick-Add was wrapped in IconButton's span, which
 * stayed a visible grid item on desktop and pushed the Task detail panel
 * onto a second row — #462 folded it into the tab bar instead.)
 *
 * jsdom applies no stylesheet, so this asserts against the CSS source — the
 * convention contentColumn.test.ts and App.mobileChrome.test.tsx use. */

const css: string = readStylesheets();

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
  it("hides the More sheet and its scrim on desktop", () => {
    expect(hidesAtDesktop(/\.more-sheet,\s*\.more-sheet-scrim\s*\{([^{}]*)\}/)).toBe(true);
  });

  it("hides the mobile tab bar on desktop", () => {
    expect(hidesAtDesktop(/\.mobile-tab-bar\s*\{([^{}]*)\}/)).toBe(true);
  });
});
