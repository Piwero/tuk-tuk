import { describe, expect, it } from "vitest";

import { type CaptureChips, planPaletteCapture } from "./paletteCapture";
import { fakeList, fakeTag } from "./test/fakeApi";

const lists = [fakeList("Errands", { id: 10 }), fakeList("Reading", { id: 11 })];
const tags = [fakeTag("urgent", { id: 30 }), fakeTag("home", { id: 31 })];
const noChips: CaptureChips = { tags: [], list: [], priority: [] };

describe("planPaletteCapture", () => {
  it("keeps a plain title and files it in the default List", () => {
    const { preview, commit } = planPaletteCapture("Buy milk", noChips, lists, tags, 10);
    expect(preview).toMatchObject({ title: "Buy milk", priority: null, list: null, tags: [] });
    expect(preview.ready).toBe(true);
    expect(commit).toEqual({ title: "Buy milk", listId: 10, priority: null, tagIds: [] });
  });

  it("parses the !priority sigil exactly as Quick-Add does", () => {
    const { preview, commit } = planPaletteCapture("Ship it !high", noChips, lists, tags, 10);
    expect(preview.title).toBe("Ship it");
    expect(preview.priority).toBe("high");
    expect(commit?.priority).toBe("high");
  });

  it("parses the ~list sigil against an existing List", () => {
    const { preview, commit } = planPaletteCapture(
      "Return book ~Reading",
      noChips,
      lists,
      tags,
      10,
    );
    expect(preview.title).toBe("Return book");
    expect(preview.list).toEqual({ id: 11, name: "Reading" });
    expect(commit?.listId).toBe(11);
  });

  it("attaches a #tag that matches an existing Tag", () => {
    const { preview, commit } = planPaletteCapture("Pay rent #urgent", noChips, lists, tags, 10);
    expect(preview.tags).toEqual([{ name: "urgent", tagId: 30 }]);
    expect(commit?.tagIds).toEqual([30]);
  });

  it("shows an unpicked #tag as an unmatched chip and never creates it", () => {
    const { preview, commit } = planPaletteCapture("Plan trip #jpn", noChips, lists, tags, 10);
    expect(preview.tags).toEqual([{ name: "jpn", tagId: null }]);
    expect(commit).toEqual({ title: "Plan trip", listId: 10, priority: null, tagIds: [] });
  });

  it("leaves an unpicked ~list token in the title and never creates a List", () => {
    const { preview, commit } = planPaletteCapture(
      "Sort things ~someday",
      noChips,
      lists,
      tags,
      10,
    );
    expect(preview.title).toBe("Sort things ~someday");
    expect(preview.list).toBeNull();
    expect(commit?.listId).toBe(10);
  });

  it("lets a picked List chip win over a same-named raw token", () => {
    const chips: CaptureChips = { tags: [], list: [fakeList("Reading", { id: 11 })], priority: [] };
    const { preview, commit } = planPaletteCapture("Read ~Reading", chips, lists, tags, 10);
    expect(preview.list).toEqual({ id: 11, name: "Reading" });
    expect(preview.title).toBe("Read ~Reading");
    expect(commit?.listId).toBe(11);
  });

  it("unions picked Tag chips with matched raw tokens, deduplicated", () => {
    const chips: CaptureChips = { tags: [fakeTag("urgent", { id: 30 })], list: [], priority: [] };
    const { commit } = planPaletteCapture("Do it #urgent #home", chips, lists, tags, 10);
    expect(commit?.tagIds).toEqual([30, 31]);
  });

  it("is not ready when the title is empty", () => {
    const { preview, commit } = planPaletteCapture("#urgent", noChips, lists, tags, 10);
    expect(preview.ready).toBe(false);
    expect(commit).toBeNull();
  });
});
