import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guard against icon-only controls regressing to unlabelled glyphs (#270).
// `aria-label` and `title` are two independently hand-maintained attributes
// with no structural link — parity depended on every contributor remembering,
// forever. `IconButton` removes that possibility structurally (one `label`
// feeds both the accessible name and the visible hint), so every interactive
// control whose only content is a glyph must adopt it. This test walks the
// source and fails CI when a new hand-rolled icon-only <button> is added.
function sourceFiles(): { file: string; text: string }[] {
  const root = join(process.cwd(), "src");
  const names = readdirSync(root, { recursive: true }) as string[];
  return names
    .filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"))
    .filter((name) => name !== join("components", "IconButton.tsx"))
    .map((name) => ({ file: join("src", name), text: readFileSync(join(root, name), "utf8") }));
}

function buttonInner(text: string, openStart: number): { inner: string } | null {
  // Scan the <button ...> open tag with brace/quote awareness: a naive
  // `[^>]*` stops at the `>` in `onClick={() => ...}` and misreads the tag.
  let i = openStart + "<button".length;
  let depth = 0;
  let quote: string | null = null;
  for (; i < text.length; i++) {
    const char = text[i];
    if (quote !== null) {
      if (char === quote) {
        quote = null;
      }
    } else if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
    } else if (char === ">" && depth === 0) {
      break;
    }
  }
  const close = text.indexOf("</button>", i);
  if (close === -1) {
    return null;
  }
  return { inner: text.slice(i + 1, close) };
}

function iconOnlyButtons(text: string): { line: number; inner: string }[] {
  const found: { line: number; inner: string }[] = [];
  for (
    let index = text.indexOf("<button");
    index !== -1;
    index = text.indexOf("<button", index + 1)
  ) {
    const parsed = buttonInner(text, index);
    if (parsed === null) {
      continue;
    }
    const inner = parsed.inner.replace(/{\/\*[\s\S]*?\*\/}/g, "").trim();
    // Icon-only means the button's whole content is one glyph: a bare
    // `<Icon/>`, or one wrapped in a hint/conditional that renders nothing
    // but the glyph (e.g. `<Hint><Icon/></Hint>`, `{x && <Icon/>}`). Any
    // visible text, count badge or second element alongside the glyph means
    // the control already names itself — not this guard's quarry.
    const withoutConditionals = inner
      .replace(/^[^{]+\{\s*&&\s*/, "")
      .replace(/\s*\}$/, "")
      .trim();
    const unwrapped = withoutConditionals
      .replace(/^<Hint\b[^>]*>/, "")
      .replace(/<\/Hint>$/, "")
      .trim();
    if (/^<Icon\b[^>]*(?:\/>|>\s*<\/Icon>)$/.test(unwrapped)) {
      found.push({ line: text.slice(0, index).split("\n").length, inner });
    }
  }
  return found;
}

describe("icon-only button guard (#270)", () => {
  it("has no hand-rolled icon-only <button> outside IconButton", () => {
    const offenders = sourceFiles().flatMap(({ file, text }) =>
      iconOnlyButtons(text).map(({ line }) => `${file}:${line}`),
    );
    expect(offenders).toEqual([]);
  });
});

// Reviewed controls that stay outside `IconButton`, and why (#270: each
// exception is recorded with a reason). None of these is a <button> whose
// only content is an <Icon/>, so the scanner above does not flag them:
// - habit-check (HabitsView): an empty circle with no Icon glyph at all;
//   a `Hint` already supplies its hover/focus text.
// - habit-strip-day (HabitCardStats): a styled square, no Icon glyph;
//   its bespoke strip hint already carries the date and state.
// - resize handles (CalendarView): divs with role=button, invisible drag
//   targets with no glyph to name.
// - month-cell-count (CalendarView): a non-interactive span, not a control.
// - IconPicker emoji buttons: their content is emoji text, and `IconButton`
//   only renders Lucide glyphs.
// - TopNavItem, ListButton, FolderNameButton, TagButton, SmartListButton,
//   quick-add-trigger, sidebar-add, theme toggle, FocusNavBadge,
//   PomoQuickStartMenu items, HabitActionsMenu items, Goal card buttons:
//   each carries a visible text label alongside its glyph, so none is an
//   icon-only control in the DOM (CSS may hide the label on the rail, where
//   the collapsed-rail hints already cover it).
// - QuickAdd assist affordance: a span, not a button, wrapped in a `Hint`.
// - HabitHistory grid-day buttons: their content is the visible date number.
// - CalendarView unscheduled-toggle: glyph plus a live count badge —
//   `IconButton` takes only a glyph, and the badge is the control's own
//   visible text, so this is not an icon-only control. `aria-label` still
//   needs its hover-hint counterpart watched by hand here.
