import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

import { describe, expect, it } from "vitest";

import { readStylesheets } from "./test/stylesheets";

/** The dark theme (#193) only re-points semantic aliases, so a surface that
 * paints a raw ramp value stays light-theme coloured on a dark ground. A Task
 * row tapped on a phone keeps `:hover`, and a near-white hover under the
 * dark theme's light title ink made the title unreadable (#482). jsdom
 * applies no CSS, so this reads the sources off disk. */

const SRC = resolve(process.cwd(), "src");
const tokens = readFileSync(join(SRC, "tokens.css"), "utf8");
const css = readStylesheets().replace(/\/\*[\s\S]*?\*\//g, "");

const darkBlock = /:root\[data-theme="dark"\]\s*\{([^}]*)\}/.exec(tokens)?.[1] ?? "";

function backgroundOf(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = new RegExp(String.raw`(?:^|[},])\s*${escaped}\s*\{([^}]*)\}`, "m").exec(css);
  const value = /background\s*:\s*([^;]+);/.exec(rule?.[1] ?? "")?.[1];
  if (value === undefined) throw new Error(`no background rule for ${selector}`);
  return value.trim();
}

describe("dark theme surfaces (#482)", () => {
  it.each([".tasks li:hover", ".month-cell[data-outside]"])(
    "%s paints a token the dark theme redefines",
    (selector) => {
      const variable = /^var\((--[\w-]+)\)$/.exec(backgroundOf(selector))?.[1];
      expect(variable, selector).toBeDefined();
      expect(darkBlock).toMatch(new RegExp(String.raw`${variable}\s*:`));
    },
  );
});
