import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

import { describe, expect, it } from "vitest";

// Every button takes one of four shared styles — primary, secondary, quiet,
// or the Focus-plum primary (#433) — so none renders with the browser's
// default look. jsdom applies no CSS, so this reads the source: every
// `<button>` must name a shared style class, or a bespoke class that
// index.css actually paints (a `background`/`border` rule).

const SHARED = ["btn-primary", "btn-secondary", "btn-quiet", "btn-focus"];

const css = (readdirSync(join(process.cwd(), "src"), { recursive: true }) as string[])
  .filter((name) => name.endsWith(".css"))
  .map((name) => readFileSync(join(process.cwd(), "src", name), "utf8"))
  .join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, "");
const tokensCss = readFileSync(join(process.cwd(), "src/tokens.css"), "utf8");

const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selectors: (m[1] as string).trim(),
  body: m[2] as string,
}));

/** `.btn-x` or `button.btn-x`. */
function isShared(selector: string, cls: string): boolean {
  return new RegExp(String.raw`^(button)?\.${cls}$`).test(selector.trim());
}

/** Classes some rule paints with a background or border. */
function painted(cls: string): boolean {
  const re = new RegExp(String.raw`\.${cls}(?![\w-])`);
  return rules.some((r) => re.test(r.selectors) && /\b(background|border)\s*:/.test(r.body));
}

/** The open tag of every `<button` in `text`, brace/quote aware. */
function buttonTags(source: string): { line: number; tag: string }[] {
  // Blank out comments (keeping newlines) so prose like "real <button>s"
  // isn't read as a tag.
  const text = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (c) => c.replace(/[^\n]/g, " "));
  const found: { line: number; tag: string }[] = [];
  for (let i = text.indexOf("<button"); i !== -1; i = text.indexOf("<button", i + 1)) {
    if (!/[\s>]/.test(text[i + "<button".length] ?? "")) continue;
    let j = i + "<button".length;
    let depth = 0;
    let quote: string | null = null;
    for (; j < text.length; j++) {
      const c = text[j];
      if (quote !== null) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    found.push({ line: text.slice(0, i).split("\n").length, tag: text.slice(i, j) });
  }
  return found;
}

function sourceFiles(): { file: string; text: string }[] {
  const root = join(process.cwd(), "src");
  return (readdirSync(root, { recursive: true }) as string[])
    .filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"))
    .map((name) => ({ file: join("src", name), text: readFileSync(join(root, name), "utf8") }));
}

describe("shared button styles (#433)", () => {
  it("defines the four styles from tokens only", () => {
    for (const cls of SHARED) {
      const body = rules
        .filter((r) => r.selectors.split(",").some((s) => isShared(s, cls)))
        .map((r) => r.body)
        .join("\n");
      expect(body, `.${cls} has no rule`).toMatch(/\b(background|border)\s*:/);
      expect(body, `.${cls} hard-codes a colour`).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
    }
    // The four share the global focus-visible ring.
    expect(css).toMatch(/button:focus-visible[^{]*\{[^}]*var\(--focus-ring\)/);
  });

  it("keeps the 44px touch floor on all four", () => {
    expect(tokensCss).toMatch(/--tap-target:\s*44px/);
    const touch = [...css.matchAll(/@media ([^{]*)\{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/g)].filter(
      (m) => /max-width:\s*720px/.test(m[1] as string) && /pointer:\s*coarse/.test(m[1] as string),
    );
    for (const cls of SHARED) {
      const floored = touch.some((m) =>
        [...(m[2] as string).matchAll(/([^{}]+)\{([^{}]*)\}/g)].some(
          (r) =>
            (r[1] as string).split(",").some((s) => isShared(s, cls)) &&
            /min-height:\s*var\(--tap-target\)/.test(r[2] as string),
        ),
      );
      expect(floored, `.${cls} lacks the touch floor`).toBe(true);
    }
  });

  it("gives every <button> a shared or painted style", () => {
    const offenders = sourceFiles().flatMap(({ file, text }) =>
      buttonTags(text)
        .filter(({ tag }) => {
          const attr = /className=(\{(?:[^{}]|\{[^{}]*\})*\}|"[^"]*")/.exec(tag)?.[1] ?? "";
          // `className={className}`: a pass-through; the caller supplies it.
          if (/^\{\s*className\s*\}$/.test(attr)) return false;
          const classes = attr.match(/[a-z][\w-]*/gi) ?? [];
          return !classes.some((c) => SHARED.includes(c) || painted(c));
        })
        .map(({ line }) => `${file}:${line}`),
    );
    expect(offenders).toEqual([]);
  });
});
