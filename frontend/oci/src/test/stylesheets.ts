import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

/** CSS-source guards include component-owned rules after the stylesheet split. */
export function readStylesheets(): string {
  const src = resolve(process.cwd(), "src");
  return [
    "index.css",
    ...readdirSync(join(src, "components"))
      .filter((name) => name.endsWith(".css"))
      .sort()
      .map((name) => `components/${name}`),
  ]
    .map((name) => readFileSync(join(src, name), "utf8"))
    .join("\n");
}
