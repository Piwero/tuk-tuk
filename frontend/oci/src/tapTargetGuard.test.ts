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
  // `calc((<a> - <b>) / <n>)` — the house form for deriving a padding from
  // the tap-target token rather than hard-coding the halved remainder (see
  // `.habit-strip button.heatmap-day`). Tokens are substituted first, so the
  // operands can be `var(...)`; only this one shape is understood, and
  // anything else reads as "not a px value" rather than being guessed at.
  if (value.startsWith("calc(")) {
    const substituted = value.replace(/var\((--[\w-]+)\)/g, (_, name: string) =>
      (tokens.get(name) ?? "?").trim(),
    );
    const calcMatch = /^calc\(\s*\(\s*([\d.]+)px\s*-\s*([\d.]+)px\s*\)\s*\/\s*([\d.]+)\s*\)$/.exec(
      substituted,
    );
    if (calcMatch === null) return null;
    const divisor = parseFloat(calcMatch[3] as string);
    if (divisor === 0) return null;
    return (parseFloat(calcMatch[1] as string) - parseFloat(calcMatch[2] as string)) / divisor;
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
  /** The media-query list of each enclosing `@media`, outermost first. A
   * rule only applies where every one of them holds. */
  conditions: string[];
}

/** Every leaf rule in index.css — including ones nested inside `@media`,
 * since `[^{}]*` can't cross into a further-nested brace, so this only ever
 * matches an innermost `selector { declarations }` block, at any nesting
 * depth. A section-header comment sitting right before a selector (e.g.
 * `/* -- Main header -- *\/\n.main-header {`) is stripped out of the
 * selector-list capture so it doesn't get parsed as part of a selector.
 *
 * Each rule carries its enclosing `@media` conditions, so a declaration can
 * be asked about at a particular viewport rather than "anywhere in the
 * file" — the difference between "sized on a phone" and "sized on the
 * desktop the ticket says must not change". Tracked by walking the braces
 * the match landed between, which is cheap and exact enough here: the
 * stylesheet nests at most two levels deep. */
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
      conditions: enclosingMedia(m.index),
    });
  }
  return rules;
}

/** The media-query list of every `@media` still open at `index`, outermost
 * first. Walks the text from the top, pushing a prelude on `{` and popping
 * on `}`. */
function enclosingMedia(index: number): string[] {
  const open: (string | null)[] = [];
  const re = /\/\*[\s\S]*?\*\/|([^{}]*)\{|\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null && m.index < index) {
    if (m[0] === "}") {
      open.pop();
    } else if (m[0].endsWith("{")) {
      const prelude = (m[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
      const media = /^@media\s+(.+)$/.exec(prelude);
      open.push(media === null ? null : (media[1] as string));
    }
  }
  return open.filter((condition): condition is string => condition !== null);
}

const rules = allRules();

/** The two viewports this guard reasons about: a phone under a finger, and
 * the desktop the ticket says must be left alone. */
interface Viewport {
  width: number;
  coarsePointer: boolean;
}

const PHONE: Viewport = { width: 390, coarsePointer: true };
const DESKTOP: Viewport = { width: 1440, coarsePointer: false };

/** Whether one `(feature: value)` holds at `viewport`. Anything this
 * doesn't model (`prefers-reduced-motion`, `prefers-color-scheme`…) reads
 * as false, so an unmodelled query can never be mistaken for sizing that
 * applies. */
function featureHolds(feature: string, viewport: Viewport): boolean {
  const [rawName, rawValue] = feature.split(":");
  const name = (rawName ?? "").trim();
  const value = (rawValue ?? "").trim();
  if (name === "max-width") {
    const px = resolvePx(value);
    return px !== null && viewport.width <= px;
  }
  if (name === "min-width") {
    const px = resolvePx(value);
    return px !== null && viewport.width >= px;
  }
  if (name === "pointer") {
    return viewport.coarsePointer ? value === "coarse" : value === "fine";
  }
  if (name === "hover") {
    return viewport.coarsePointer ? value === "none" : value === "hover";
  }
  return false;
}

/** Whether a media-query list holds at `viewport`: any comma-separated
 * query all of whose features hold. */
function queryHolds(list: string, viewport: Viewport): boolean {
  return splitSelectors(list).some((query) => {
    const features = [...query.matchAll(/\(([^)]*)\)/g)].map((match) => match[1] as string);
    return features.length > 0 && features.every((feature) => featureHolds(feature, viewport));
  });
}

/** Every rule naming `selector` that applies at `viewport`. */
function rulesFor(selector: string, viewport: Viewport): Rule[] {
  return rules.filter(
    (rule) =>
      rule.selectors.includes(selector) &&
      rule.conditions.every((condition) => queryHolds(condition, viewport)),
  );
}

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
 * rule that applies at `viewport` — so a mobile-only override is picked up
 * at phone width and *not* at desktop width, which is what lets the same
 * helper prove both "sized on a phone" and "desktop untouched". Falls back
 * to `width`/`min-width` for controls sized as a square via width alone.
 * `null` means no size was declared for this selector at this viewport. */
function declaredSize(selector: string, viewport: Viewport = PHONE): number | null {
  const heights: number[] = [];
  const widths: number[] = [];
  for (const rule of rulesFor(selector, viewport)) {
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

function findOffenders(selectors: string[]): Offender[] {
  return selectors
    .map((selector) => ({ selector, size: declaredSize(selector), line: lineOf(selector) }))
    .filter((entry) => entry.size === null || entry.size < TAP_TARGET)
    .sort((a, b) => a.line - b.line);
}

function offenderMessage(where: string, offenders: Offender[]): string {
  const lines = offenders.map(
    (o) =>
      `  ${o.selector} (src/index.css:${o.line}) — ${o.size === null ? "no size declared" : `${o.size}px`}`,
  );
  return [
    `${offenders.length} control(s) on ${where} fall under the ${TAP_TARGET}px tap-target floor on mobile:`,
    ...lines,
  ].join("\n");
}

/** The declarations for `selector` that apply at `viewport`, comments
 * stripped and concatenated — so a rule can be asserted against without
 * this test needing to know which media query it was written in, while
 * still distinguishing phone from desktop. */
function declarationsFor(selector: string, viewport: Viewport = PHONE): string {
  return rulesFor(selector, viewport)
    .map((rule) => rule.declBody.replace(/\/\*[\s\S]*?\*\//g, ""))
    .join("\n");
}

/** The last declared value of `property` for `selector` at `viewport` —
 * later rules win, which is close enough to the cascade for the
 * single-specificity selectors asserted here. */
function declaredValue(
  selector: string,
  property: string,
  viewport: Viewport = PHONE,
): string | null {
  const matches = [
    ...declarationsFor(selector, viewport).matchAll(
      new RegExp(String.raw`\b${property}\s*:\s*([^;]+);`, "g"),
    ),
  ];
  const last = matches[matches.length - 1];
  return last === undefined ? null : (last[1] as string).trim();
}

describe("tap-target floor on mobile task-listing surfaces (issue #286)", () => {
  // Skipped per #286's second allowed landing state: still red until #289
  // sizes the main header and filter row. #288 took the Modal/Quick-Add half
  // (asserted green below); flip this back to `it(...)` with #289.
  it.skip("meets the 44px floor for controls on the main header, filter row and Modal", () => {
    const offenders = findOffenders(mobileSurfaceControls());
    expect(offenders, offenderMessage("the main header, filter row or a Modal", offenders)).toEqual(
      [],
    );
  });
});

/** Every control the Quick-Add dialog actually renders (issue #288), named
 * as the selector that has to size it, with the element it is.
 *
 * Deliberately a fixed list read off QuickAddDialog.tsx / DateFieldset.tsx /
 * TokenInput.tsx / Modal.tsx rather than harvested from the stylesheet the
 * way `mobileSurfaceControls` is: a corpus derived from the CSS shrinks when
 * the CSS is deleted, so dropping the sizing rule would empty the offender
 * list and pass. The whole point of this guard is that removing the sizing
 * fails, so the list of what must be sized cannot come from the sizing. */
const QUICK_ADD_CONTROLS: { selector: string; what: string }[] = [
  { selector: ".modal-close", what: "the dialog's Close control" },
  {
    selector: '.quick-add-dialog input:not([type="checkbox"])',
    what: "the title / New tag / date / time fields",
  },
  { selector: ".quick-add-dialog select", what: "the List and Priority selects" },
  {
    selector: ".quick-add-dialog .date-actions button",
    what: "the Today / Tomorrow / Next Week / Clear date shortcuts",
  },
  { selector: ".quick-add-dialog-actions button", what: "the Cancel and Add task commit pair" },
  {
    selector: ".quick-add-dialog .quick-add-assist-chips button",
    what: "the Assist recurrence / reminder chips' remove buttons",
  },
  {
    selector: ".quick-add-dialog .token-input-dropdown li",
    what: "the token suggestion dropdown's rows",
  },
];

describe("Quick-Add dialog is operable on touch (issue #288)", () => {
  it("meets the 44px floor for every control in the dialog", () => {
    const offenders = findOffenders(QUICK_ADD_CONTROLS.map((control) => control.selector));
    const named = offenders.map((offender) => {
      const control = QUICK_ADD_CONTROLS.find((c) => c.selector === offender.selector);
      return { ...offender, selector: `${offender.selector} — ${control?.what ?? "?"}` };
    });
    expect(named, offenderMessage("the Quick-Add dialog", named)).toEqual([]);
  });

  /** AC: "Desktop layout and sizing are unchanged". The sizing above must be
   * gated so that none of it reaches a desktop with a mouse — the same
   * helper, asked about `DESKTOP`, sees only the rules that apply there. */
  it("leaves the dialog's controls at their desktop size", () => {
    const grown = QUICK_ADD_CONTROLS.filter((control) => {
      const size = declaredSize(control.selector, DESKTOP);
      return size !== null && size >= TAP_TARGET;
    });
    expect(
      grown.map((control) => control.selector),
      "these controls are sized to the touch floor on desktop too — the rule is not gated",
    ).toEqual([]);
  });

  /** The established convention (#168, and the `.tasks label` rule): the hit
   * area grows through the wrapping label's padding, the visible box does
   * not. Asserted as "padding that reaches the floor" plus "no rule anywhere
   * grows a checkbox past 18px", so growing the box instead fails here. */
  it("grows a checkbox's hit area through its label, not the box", () => {
    const selector = '.quick-add-dialog label:has(> input[type="checkbox"])';
    const padding = declaredValue(selector, "padding");
    expect(padding, "no padding declared on the checkbox label").not.toBeNull();
    const px = resolvePx(padding as string);
    expect(px, `checkbox label padding must resolve to px, got \`${padding}\``).not.toBeNull();
    // Box (18px) + padding on both sides must clear the floor.
    expect(18 + (px as number) * 2).toBeGreaterThanOrEqual(TAP_TARGET);

    // Any rule that sizes a checkbox — base or override — keeps the 18px box.
    const boxes = rules
      .filter((rule) => rule.selectors.some((s) => s.includes('input[type="checkbox"]')))
      .flatMap((rule) => [...rule.declBody.matchAll(/\b(?:min-)?(?:width|height)\s*:\s*([^;]+);/g)])
      .map((match) => resolvePx(match[1] as string))
      .filter((size): size is number => size !== null);
    expect(Math.max(...boxes), "a rule grows the visible checkbox past 18px").toBeLessThanOrEqual(
      18,
    );
  });

  /** Roughly 3px apart at the same height, submit beside Cancel, is a
   * coin-flip between filing the Task and discarding it. Pushed to opposite
   * ends of the row, the dialog's whole width sits between them. */
  it("separates the commit action from Cancel", () => {
    expect(declaredValue(".quick-add-dialog-actions", "justify-content")).toBe("space-between");
    // Desktop keeps them grouped at the trailing edge.
    expect(declaredValue(".quick-add-dialog-actions", "justify-content", DESKTOP)).toBe("flex-end");
  });

  /** Sizing the controls makes the dialog taller than a short viewport, and
   * `.modal` had no scroll of its own: the commit action fell off the bottom.
   * The panel caps its height against the backdrop and scrolls within it. */
  it("scrolls the Modal panel when its content outgrows the viewport", () => {
    const cap = declaredValue(".modal", "max-height");
    expect(cap, "the Modal panel declares no height cap").not.toBeNull();
    expect(declaredValue(".modal", "overflow-y"), "the Modal panel does not scroll").toBe("auto");
    // The backdrop it caps against must be the viewport-sized, scrollable
    // box `max-height: 100%` resolves against, or the cap means nothing.
    expect(declaredValue(".modal-backdrop", "position")).toBe("fixed");
    expect(declaredValue(".modal-backdrop", "inset")).toBe("0");
    expect(declaredValue(".modal-backdrop", "overflow-y")).toBe("auto");
    // Desktop never capped or scrolled the panel, and must not start.
    expect(declaredValue(".modal", "max-height", DESKTOP)).toBeNull();
    expect(declaredValue(".modal", "overflow-y", DESKTOP)).toBeNull();
  });
});
