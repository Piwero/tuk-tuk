import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { HINT_REGISTRY } from "./hintRegistry";

// Whole-app pass over the copy registry (#270): the per-ticket data tests
// cover their own keys, this guards the registry as data — every key a call
// site references resolves, no entry is empty, and no domain term is
// explained in two different wordings across two surfaces.
const SRC = join(process.cwd(), "src");

function sourceTexts(): string[] {
  const names = readdirSync(SRC, { recursive: true }) as string[];
  return names
    .filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"))
    .map((name) => readFileSync(join(SRC, name), "utf8"));
}

function referencedKeys(texts: string[]): string[] {
  const joined = texts.join("\n");
  const keys = new Set<string>();
  for (const match of joined.matchAll(/(?:hintKey|descriptionKey)=["']([\w-]+)["']/g)) {
    const key = match[1];
    if (key !== undefined) {
      keys.add(key);
    }
  }
  // The Smart-list map's keys sit behind a Record<SmartView, HintKey>, not a
  // JSX attribute — read to the map's closing brace at column 0 rather than
  // the first `}` (a naive `[^}]+` stops at the nested Record's brace).
  const smart = joined.match(/SMART_HINT_KEYS[^=]*=\{([\s\S]+?)\n\};/);
  const smartBody = smart?.[1];
  if (smartBody !== undefined) {
    for (const match of smartBody.matchAll(/["']([\w-]+)["']/g)) {
      const key = match[1];
      if (key !== undefined) {
        keys.add(key);
      }
    }
  }
  // Bracket reads of the registry itself (`HINT_REGISTRY.inbox`,
  // `HINT_REGISTRY[hintKey]` excluded — the latter is `Hint`'s own dynamic
  // lookup, not a referenced key).
  for (const match of joined.matchAll(/HINT_REGISTRY\.(\w+)/g)) {
    const key = match[1];
    if (key !== undefined) {
      keys.add(key);
    }
  }
  for (const match of joined.matchAll(/HINT_REGISTRY\["([\w-]+)"\]/g)) {
    const key = match[1];
    if (key !== undefined) {
      keys.add(key);
    }
  }
  return [...keys].sort();
}

describe("HINT_REGISTRY whole-app pass (#270)", () => {
  it("resolves every key referenced by a call site", () => {
    const keys = referencedKeys(sourceTexts());
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(
        HINT_REGISTRY as Record<string, string | undefined>,
        `missing entry for "${key}"`,
      ).toHaveProperty(key);
    }
  });

  it("has no empty entries", () => {
    for (const [key, copy] of Object.entries(HINT_REGISTRY)) {
      expect(copy.trim(), `entry for "${key}" is empty`).not.toBe("");
    }
  });

  it("explains no domain term in two different wordings", () => {
    const seen = new Map<string, string>();
    for (const [key, copy] of Object.entries(HINT_REGISTRY)) {
      const normalized = copy
        .trim()
        .replace(/\s+/g, " ")
        .replace(/[.?!]+$/, "")
        .toLowerCase();
      const clash = seen.get(normalized);
      expect(clash, `"${key}" duplicates the wording of "${clash}"`).toBeUndefined();
      seen.set(normalized, key);
    }
  });
});
