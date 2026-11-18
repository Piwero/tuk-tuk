import { describe, expect, it } from "vitest";

import { readStylesheets } from "./test/stylesheets";

// Mobile Today (#460): compact header and two-line rows. jsdom applies no
// stylesheet, so — like App.mobileChrome.test.tsx — the CSS is asserted
// against its source.

const css = readStylesheets();

/** Concatenated bodies of every @media block whose query matches. */
function mediaBodies(match: (query: string) => boolean): string {
  const out: string[] = [];
  const re = /@media\s+([^{]+)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
    }
    if (match(m[1] as string)) out.push(css.slice(m.index, i));
  }
  return out.join("\n");
}

const mobile = mediaBodies((q) => q.includes("max-width: 720px"));
const coarse = mediaBodies((q) => q.includes("pointer: coarse"));

function rule(source: string, selector: RegExp): string {
  const m = new RegExp(`${selector.source}\\s*\\{([^{}]*)\\}`).exec(source);
  return m?.[1] ?? "";
}

describe("mobile Today rows (#460)", () => {
  it("keeps the metadata to a single line under the title", () => {
    const body = rule(mobile, /\.tasks li\.task-row \.task-row-meta/);
    expect(body).toMatch(/flex-wrap:\s*nowrap/);
    expect(body).toMatch(/overflow:\s*hidden/);
  });

  it("shows the List as its colour dot alone, name kept for assistive tech", () => {
    const body = rule(mobile, /\.tasks li\.task-row \.list-name/);
    expect(body).toMatch(/clip-path:\s*inset\(50%\)/);
    expect(body).toMatch(/position:\s*absolute/);
  });

  it("lets revealed row actions wrap instead of being clipped by the one-line meta", () => {
    const body = rule(mobile, /\.tasks li\.task-row\[data-actions-open="true"\] \.task-row-meta/);
    expect(body).toMatch(/flex-wrap:\s*wrap/);
    expect(body).toMatch(/overflow:\s*visible/);
  });

  it("drops the row's vertical padding so the 44px title line is the row's height", () => {
    const body = rule(mobile, /\.tasks li\.task-row/);
    expect(body).toMatch(/padding:\s*0 var\(--space-2\)/);
  });
});

describe("mobile Today header (#460)", () => {
  it("hides the drag hint under a coarse pointer", () => {
    expect(rule(coarse, /\.sort-drag-hint/)).toMatch(/display:\s*none/);
  });

  it("lets the View button sit beside the title instead of stacking a toolbar", () => {
    expect(rule(mobile, /\.main-chrome/)).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) auto/);
    const button = rule(mobile, /\.main-chrome > \.view-controls/);
    expect(button).toMatch(/grid-row:\s*1/);
    expect(button).toMatch(/margin:\s*0/);
  });

  it("opens the View menu as a bottom sheet", () => {
    const body = rule(mobile, /\.view-menu-popover/);
    expect(body).toMatch(/position:\s*fixed/);
    expect(body).toMatch(/bottom:\s*0/);
  });
});
