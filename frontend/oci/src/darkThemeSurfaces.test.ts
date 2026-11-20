import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

import { describe, expect, it } from "vitest";

/** The dark theme (#193) only re-points semantic aliases, so a surface that
 * paints a raw ramp value stays light-theme coloured on a dark ground. A Task
 * row tapped on a phone keeps `:hover`, and a near-white hover under the
 * dark theme's light title ink made the title unreadable (#482). jsdom
 * applies no CSS, so this reads the sources off disk. */

const SRC = resolve(process.cwd(), "src");
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");
const tokens = stripComments(readFileSync(join(SRC, "tokens.css"), "utf8"));

/** A base-ramp step (`--ink-50`, `--plum-700`) or `--white`. */
const RAMP = /var\(--(?:(?:ink|blue|green|red|amber|plum)-\d+|white)\)/;

function block(selector: string): string {
  const start = tokens.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no ${selector} block in tokens.css`);
  return tokens.slice(start, tokens.indexOf("}", start));
}

function declarations(body: string): Map<string, string> {
  return new Map(
    [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1] as string, m[2] as string]),
  );
}

const stylesheets = (readdirSync(SRC, { recursive: true }) as string[])
  .filter((name) => name.endsWith(".css") && name !== "tokens.css")
  .sort();

describe("dark theme surfaces (#482)", () => {
  it.each(stylesheets)("%s paints semantic aliases, never a raw ramp step", (name) => {
    const lines = stripComments(readFileSync(join(SRC, name), "utf8")).split("\n");
    const offenders = lines
      .map((line, i) => ({ line: i + 1, text: line.trim() }))
      .filter(({ text }) => RAMP.test(text));
    expect(offenders).toEqual([]);
  });

  it("re-points every alias the light theme builds from a ramp step", () => {
    const light = declarations(block(":root"));
    const dark = declarations(block(':root[data-theme="dark"]'));
    const missing = [...light]
      .filter(([name]) => !/^--(?:ink|blue|green|red|amber|plum)-\d+$/.test(name))
      .filter(([, value]) => RAMP.test(value))
      .map(([name]) => name)
      .filter((name) => !dark.has(name));
    expect(missing).toEqual([]);
  });
});
