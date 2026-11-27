import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

/** CSS-source guards include component-owned rules after the stylesheet split. */
export function readStylesheets(): string {
  const src = resolve(process.cwd(), "src");
  return [
    "primitives.css",
    "App.css",
    "AuthGate.css",
    ...readdirSync(join(src, "components"))
      .filter((name) => name.endsWith(".css"))
      .sort()
      .map((name) => `components/${name}`),
  ]
    .map((name) => readFileSync(join(src, name), "utf8"))
    .join("\n");
}

/** The declarations of the first rule whose selector is exactly `selector`
 * at the start of a line — `{` to `}`, without the selector. Throws when no
 * such rule exists, so a renamed selector fails the guard instead of
 * matching nothing. */
export function cssRuleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (match === null) {
    throw new Error(`${selector} rule not found`);
  }
  return match[1] ?? "";
}
