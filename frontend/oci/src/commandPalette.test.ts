import { describe, expect, it, vi } from "vitest";

import { flattenGroups, groupItems, matchesQuery, type PaletteItem } from "./commandPalette";

function item(kind: PaletteItem["kind"], label: string): PaletteItem {
  return { key: `${kind}-${label}`, kind, label, run: vi.fn() };
}

describe("matchesQuery", () => {
  it("matches every whitespace-separated term, case-insensitively", () => {
    expect(matchesQuery("Weekly team sync", "team SYNC")).toBe(true);
    expect(matchesQuery("Weekly team sync", "team lunch")).toBe(false);
  });

  it("matches everything on a blank query", () => {
    expect(matchesQuery("anything", "   ")).toBe(true);
  });
});

describe("groupItems", () => {
  const items = [
    item("smart", "Today"),
    item("list", "Errands"),
    item("list", "Reading list"),
    item("tag", "#errand"),
    item("task", "Buy milk"),
  ];

  it("buckets matches by kind in the fixed group order, dropping empty groups", () => {
    const groups = groupItems(items, "");
    expect(groups.map((group) => group.kind)).toEqual(["smart", "list", "tag", "task"]);
  });

  it("filters across kinds by the query", () => {
    const groups = groupItems(items, "err");
    expect(flattenGroups(groups).map((entry) => entry.label)).toEqual(["Errands", "#errand"]);
  });

  it("flattens groups in render order", () => {
    const groups = groupItems(items, "");
    expect(flattenGroups(groups).map((entry) => entry.label)).toEqual([
      "Today",
      "Errands",
      "Reading list",
      "#errand",
      "Buy milk",
    ]);
  });
});
