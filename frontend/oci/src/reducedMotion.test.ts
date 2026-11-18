import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

import { describe, expect, it } from "vitest";

const SRC = resolve(process.cwd(), "src");

describe("bottom sheets under reduced motion", () => {
  // Story 136: a sheet sliding in must sit still when motion is reduced.
  it.each(["components/MoreSheet.css", "components/TaskDetail.css"])(
    "%s drops its sheet animation for prefers-reduced-motion",
    (file) => {
      const css = readFileSync(join(SRC, file), "utf8");
      const block = css.split("@media (prefers-reduced-motion: reduce)")[1] ?? "";
      expect(block).toMatch(/animation:\s*none/);
    },
  );
});
