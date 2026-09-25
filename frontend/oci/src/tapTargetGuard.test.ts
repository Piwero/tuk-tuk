import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

import { describe, expect, it } from "vitest";

/** The 44px `--tap-target` floor (issue #168) is applied inside `@media
 * (hover: none), (pointer: coarse)` blocks in index.css, but those blocks
 * only reach the sidebar, row actions, Goal cards and Folder rows. The main
 * header, the filter row and any Modal are never touched by them, so a
 * control there can ship under 44px and nothing catches it (issue #286).
 *
 * Two reasons this can't be tested the usual way:
 * - jsdom applies no stylesheet, so a rendered control's height is
 *   unobservable in component tests.
 * - A desktop browser at a phone-width viewport reports `pointer: fine`, so
 *   the coarse-only media query never runs there — DevTools' device toolbar
 *   gives a false pass.
 *
 * So, like `contentColumn.test.ts` and the due-date-chip tests in
 * TaskRow.test.tsx, this reads index.css/tokens.css off disk and asserts
 * against the CSS source text directly: it keys off the *mobile breakpoint*
 * (`@media (max-width: 720px)`), not `pointer: coarse` alone, since a
 * touch-capable laptop/tablet reporting `pointer: fine` gets the same floor
 * per the ticket's scope note. */

const css: string = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");
const tokensCss: string = readFileSync(resolve(process.cwd(), "src/tokens.css"), "utf8");

const TAP_TARGET = 44;

/** `--name: value;` pairs from tokens.css, so a declaration like `width:
 * var(--tap-target)` resolves to a comparable px number. */
function tokenMap(): Map<string, string> {
  const map = new Map<string, string>();
  const re = /(--[\w-]+):\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tokensCss)) !== null) {
    const name = m[1] as string;
    const value = (m[2] as string).replace(/\/\*[\s\S]*?\*\//g, "").trim();
    map.set(name, value);
  }
  return map;
}

const tokens = tokenMap();

function resolvePx(raw: string): number | null {
  const value = raw.trim();
  const varMatch = /^var\((--[\w-]+)\)$/.exec(value);
  if (varMatch) {
    const resolved = tokens.get(varMatch[1] as string);
    return resolved === undefined ? null : resolvePx(resolved);
  }
  const pxMatch = /^([\d.]+)px$/.exec(value);
  return pxMatch ? parseFloat(pxMatch[1] as string) : null;
}

/** Splits a CSS selector list on top-level commas — paren-aware, so a
 * `:has(a, b)` argument list doesn't get mistaken for two selectors. */
function splitSelectors(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const char = list[i];
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === "," && depth === 0) {
      parts.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(list.slice(start).trim());
  return parts.filter((selector) => selector.length > 0);
}

interface Rule {
  selectors: string[];
  declBody: string;
  index: number;
}

/** Every leaf rule in index.css — including ones nested inside `@media`,
 * since `[^{}]*` can't cross into a further-nested brace, so this only ever
 * matches an innermost `selector { declarations }` block, at any nesting
 * depth. A section-header comment sitting right before a selector (e.g.
 * `/* -- Main header -- *\/\n.main-header {`) is stripped out of the
 * selector-list capture so it doesn't get parsed as part of a selector. */
function allRules(): Rule[] {
  const rules: Rule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const selectorList = (m[1] as string).replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (selectorList.length === 0) continue;
    rules.push({
      selectors: splitSelectors(selectorList),
      declBody: m[2] as string,
      index: m.index,
    });
  }
  return rules;
}

const rules = allRules();

/** True when `selector` is a real descendant of `.<parentClass>` — via a
 * space, a `>` combinator, or a `:has(...)`/pseudo chained straight onto
 * it — not just another class that happens to share the same text
 * (`.main-header-foo` must not count as scoped to `.main-header`). */
function isDescendantOf(selector: string, parentClass: string): boolean {
  const prefix = `.${parentClass}`;
  if (!selector.startsWith(prefix)) return false;
  const rest = selector.slice(prefix.length);
  return rest.startsWith(" ") || rest.startsWith(">") || rest.startsWith(":");
}

/** True when `selector` is a bare tag — `button`, `select`, `input`,
 * `textarea` or `a` — optionally itself qualified by classes
 * (`button.folder-disclosure`), as the *last* simple selector in a
 * descendant chain. Filters out headings and labels wrapping a real
 * control, which surface separately through their own selector. */
function tailIsControlTag(selector: string): boolean {
  const tail = selector.split(/[\s>]+/).pop() ?? "";
  return /^(button|select|input|textarea|a)(\.[\w-]+)*(:[\w-]+(\([^)]*\))?)*$/.test(tail);
}

/** Containers, headings and wrapper spans that share a family prefix with
 * real controls but aren't themselves tappable — the modal panel, its
 * header row, the filter menu's own toggle-content selector and so on.
 * Kept small and type-based (container/heading/wrapper), not one entry per
 * control, so a *new* control under these prefixes is covered without
 * touching this list — only a new non-interactive container would need
 * adding here, exactly as the production `@media (hover: none), (pointer:
 * coarse)` block below is hand-maintained one touch-surface at a time. */
const NON_INTERACTIVE_EXACT = new Set([
  ".modal",
  ".modal:focus",
  ".modal-backdrop",
  ".modal-header",
  ".modal-header h2",
  ".modal-header > .icon-button-wrap",
  ".filter-menu",
  ".filter-menu-trigger-row",
  ".filter-menu-popover",
]);

/** The main header renders a couple of its own controls (breadcrumb, view
 * toggle, completed toggle) as top-level, unscoped classnames rather than
 * under a `.main-header-` prefix or a `.main-header X` descendant selector
 * — so, unlike Modal (`.modal-*`) and the filter menu (`.filter-menu-*`),
 * they can't be discovered generically from the CSS text alone and are
 * listed by hand, the same way the production touch-target block below
 * enumerates its own concrete selectors rather than deriving containment. */
const MAIN_HEADER_ANCHORS = [".view-toggle", ".completed-toggle", ".breadcrumb-folder"];

/** Every selector on the three surfaces #286 calls out — main header,
 * filter row (`.view-controls`, plus its own `.filter-menu-*`/filter chip
 * children), and any Modal — that denotes a real interactive control. */
/** A state pseudo (`:hover`, `:focus`…) tacked onto an already-counted base
 * selector names the same control, not a second one — skip it so the
 * offender list reports one entry per control, not one per rule. */
const STATE_PSEUDO = /:(hover|focus|focus-visible|active|disabled)(\([^)]*\))?$/;

function mobileSurfaceControls(): string[] {
  const found = new Set<string>();
  for (const rule of rules) {
    for (const selector of rule.selectors) {
      if (NON_INTERACTIVE_EXACT.has(selector) || STATE_PSEUDO.test(selector)) continue;

      const isModalFamily = /^\.modal(?:[.\-:]|$)/.test(selector);
      const isFilterMenuFamily = /^\.filter-menu(?:[.\-:]|$)/.test(selector);
      const isAnchor = MAIN_HEADER_ANCHORS.includes(selector);
      if (isModalFamily || isFilterMenuFamily || isAnchor) {
        found.add(selector);
        continue;
      }

      const isHeaderDescendant = isDescendantOf(selector, "main-header");
      const isViewControlsDescendant = isDescendantOf(selector, "view-controls");
      const isFilterChipDescendant = isDescendantOf(selector, "filter-chip");
      if (
        (isHeaderDescendant || isViewControlsDescendant || isFilterChipDescendant) &&
        tailIsControlTag(selector)
      ) {
        found.add(selector);
      }
    }
  }
  return [...found];
}

/** The largest declared `height`/`min-height` for `selector` across every
 * rule in the file that names it — so an override elsewhere (e.g. inside a
 * mobile-only block) is picked up without this test needing to know which
 * media query it lives in. Falls back to `width`/`min-width` for controls
 * sized as a square via width alone. `null` means no size was declared for
 * this selector anywhere. */
function declaredSize(selector: string): number | null {
  const heights: number[] = [];
  const widths: number[] = [];
  for (const rule of rules) {
    if (!rule.selectors.includes(selector)) continue;
    const body = rule.declBody.replace(/\/\*[\s\S]*?\*\//g, "");
    const declRe = /\b(min-height|height|min-width|width)\s*:\s*([^;]+);/g;
    let d: RegExpExecArray | null;
    while ((d = declRe.exec(body)) !== null) {
      const property = d[1] as string;
      const px = resolvePx(d[2] as string);
      if (px === null) continue;
      if (property === "height" || property === "min-height") heights.push(px);
      else widths.push(px);
    }
  }
  if (heights.length > 0) return Math.max(...heights);
  if (widths.length > 0) return Math.max(...widths);
  return null;
}

function lineOf(selector: string): number {
  const rule = rules.find((r) => r.selectors.includes(selector));
  if (rule === undefined) return -1;
  return css.slice(0, rule.index).split("\n").length;
}

interface Offender {
  selector: string;
  size: number | null;
  line: number;
}

function findOffenders(): Offender[] {
  return mobileSurfaceControls()
    .map((selector) => ({ selector, size: declaredSize(selector), line: lineOf(selector) }))
    .filter((entry) => entry.size === null || entry.size < TAP_TARGET)
    .sort((a, b) => a.line - b.line);
}

function offenderMessage(offenders: Offender[]): string {
  const lines = offenders.map(
    (o) =>
      `  ${o.selector} (src/index.css:${o.line}) — ${o.size === null ? "no size declared" : `${o.size}px`}`,
  );
  return [
    `${offenders.length} control(s) on the main header, filter row or a Modal fall under the ${TAP_TARGET}px tap-target floor on mobile:`,
    ...lines,
  ].join("\n");
}

describe("tap-target floor on mobile task-listing surfaces (issue #286)", () => {
  it("meets the 44px floor for controls on the main header, filter row and Modal", () => {
    const offenders = findOffenders();
    // Lands RED on purpose (#286): the offender list below is the worklist
    // for the two sizing tickets that follow this one — this guard is not
    // meant to be fixed here, only to stop a *new* undersized control from
    // landing unnoticed once those tickets green it.
    expect(offenders, offenderMessage(offenders)).toEqual([]);
  });
});
