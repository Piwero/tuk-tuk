import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { installFakeApi } from "./test/fakeApi";

// Mobile shell polish (issue #290): the title plus its filter controls pin
// while the list scrolls, the drawer locks the scroll behind it, and the
// drawer's close control meets the touch floor. jsdom applies no stylesheet,
// so the CSS half is asserted against the source text directly — the same
// convention as tapTargetGuard.test.ts and contentColumn.test.ts — while the
// DOM half renders the real App.

const css: string = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

/** Ranges of every `@media` block: its query plus the body's span. */
function mediaBlocks(): { query: string; start: number; end: number }[] {
  const blocks: { query: string; start: number; end: number }[] = [];
  const re = /@media\s+([^{]+)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
    }
    blocks.push({ query: m[1] as string, start: m.index, end: i });
  }
  return blocks;
}

const blocks = mediaBlocks();

function isMobileBlock(query: string): boolean {
  return query.includes("max-width: 720px");
}

/** Bodies of every rule matching `pattern`, each tagged mobile or not. */
function selectorRules(pattern: RegExp): { body: string; mobile: boolean }[] {
  const found: { body: string; mobile: boolean }[] = [];
  const re = new RegExp(pattern.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const mobile = blocks.some(
      (block) =>
        isMobileBlock(block.query) && m !== null && m.index > block.start && m.index < block.end,
    );
    found.push({ body: m[1] as string, mobile });
  }
  return found;
}

/** Bodies of every `.main-chrome` rule, each tagged mobile or not. */
function chromeRules(): { body: string; mobile: boolean }[] {
  return selectorRules(/\.main-chrome\s*\{([^{}]*)\}/);
}

/** Bodies of every `.sidebar .drawer-close` rule, each tagged mobile or not. */
function drawerCloseRules(): { body: string; mobile: boolean }[] {
  return selectorRules(/\.sidebar\s+\.drawer-close\s*\{([^{}]*)\}/);
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function openAll(): Promise<void> {
  const nav = await screen.findByRole("navigation", { name: "Smart Lists" });
  fireEvent.click(await within(nav).findByRole("button", { name: "All" }));
  await screen.findByRole("heading", { name: "All" });
}

describe("mobile shell polish (issue #290)", () => {
  it("wraps the title and the filter controls in one chrome element", async () => {
    installFakeApi();
    render(<App />);
    await openAll();

    const chrome = document.querySelector(".main-chrome");
    expect(chrome).not.toBeNull();
    // The view title …
    expect(chrome?.querySelector(".main-header h1")).not.toBeNull();
    // … and the filter controls live inside it, so one sticky rule pins both.
    const controls = chrome?.querySelector(".view-controls");
    expect(controls).not.toBeNull();
    expect(
      within(controls as HTMLElement).getByRole("button", { name: /^Filters/ }),
    ).toBeInTheDocument();
  });

  it("pins that chrome on mobile, with a background so rows scroll beneath it", () => {
    const rules = chromeRules();
    const sticky = rules.filter((rule) => /position:\s*sticky/.test(rule.body));
    expect(sticky.length).toBeGreaterThan(0);
    for (const rule of sticky) {
      expect(rule.mobile).toBe(true);
      expect(rule.body).toMatch(/top:\s*0/);
      expect(rule.body).toMatch(/background:\s*var\(--surface-page\)/);
    }
  });

  it("leaves the desktop layout untouched: no sticky chrome outside mobile", () => {
    const outside = chromeRules().filter(
      (rule) => !rule.mobile && /position:\s*sticky/.test(rule.body),
    );
    expect(outside).toEqual([]);
  });

  it("stacks the drawer and scrim above the pinned chrome", () => {
    const sticky = chromeRules().find((rule) => /position:\s*sticky/.test(rule.body));
    const zIndex = /z-index:\s*([\d.]+)/.exec(sticky?.body ?? "")?.[1];
    expect(zIndex, "pinned chrome declares no numeric z-index").not.toBeUndefined();
    // Drawer, scrim, tab bar and Quick-Add all sit on `calc(var(--z-modal)
    // - n)` (≥ 96): the chrome must stay well under every one of them.
    expect(parseFloat(zIndex as string)).toBeLessThan(90);
    for (const selector of [".drawer-scrim", ".mobile-tab-bar", ".mobile-quick-add"]) {
      expect(css).toMatch(new RegExp(`${selector.replace(/\./g, "\\.")}[^{]*\\{[^}]*z-index:`));
    }
  });

  it("sizes the drawer's close control to the touch floor at mobile widths", () => {
    const mobile = drawerCloseRules().filter((rule) => rule.mobile);
    expect(mobile.length).toBeGreaterThan(0);
    for (const rule of mobile) {
      expect(rule.body).toMatch(/width:\s*var\(--tap-target\)/);
      expect(rule.body).toMatch(/height:\s*var\(--tap-target\)/);
    }
  });

  it("keeps the Quick-Add dialog outside the pinned chrome's stacking context", async () => {
    // `.main-chrome` is `position: sticky` with a z-index, so it forms a
    // stacking context: a Modal rendered inside it could never rise above
    // the drawer/scrim no matter its own z-index. The dialog must stay a
    // sibling of the chrome, not a child.
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "All" });

    await user.click(screen.getByRole("button", { name: "Quick add task" }));
    const dialog = await screen.findByRole("dialog", { name: "Quick add" });
    expect(dialog.closest(".main-chrome")).toBeNull();
  });

  it("preserves the list's scroll position across the drawer scroll lock", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "All" });

    const main = screen.getByRole("main");
    main.scrollTop = 123;

    await user.click(screen.getByRole("button", { name: "Show navigation" }));
    expect(main.style.overflow).toBe("hidden");

    const sidebar = screen.getByRole("complementary");
    await user.click(within(sidebar).getByRole("button", { name: "Close navigation" }));
    expect(main.style.overflow).toBe("");
    expect(main.scrollTop).toBe(123);
  });
});
