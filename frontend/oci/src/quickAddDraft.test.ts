import { afterEach, describe, expect, it, vi } from "vitest";

import { emptyDraft } from "./dates";
import {
  clearQuickAddDraft,
  loadQuickAddDraft,
  saveQuickAddDraft,
  type QuickAddDraft,
} from "./quickAddDraft";

afterEach(() => {
  vi.restoreAllMocks();
});

const draft = (title: string): QuickAddDraft => ({
  title,
  listId: null,
  priority: "none",
  priorityChosen: false,
  tagIds: [],
  newTag: "",
  dateDraft: emptyDraft(),
});

describe("Quick-Add session draft storage (#541)", () => {
  it("keeps each User's draft apart and clears only the one asked for", () => {
    saveQuickAddDraft(1, { ...draft("Call the dentist"), listId: 4, tagIds: [7] });

    expect(loadQuickAddDraft(1)).toEqual({
      ...draft("Call the dentist"),
      listId: 4,
      tagIds: [7],
    });
    // Another User sees nothing, and the first User's draft is dropped on
    // the way, so it cannot surface for anyone else on this tab.
    expect(loadQuickAddDraft(2)).toBeNull();
    expect(loadQuickAddDraft(1)).toBeNull();

    saveQuickAddDraft(2, draft("Buy oat milk"));
    clearQuickAddDraft(2);
    expect(loadQuickAddDraft(2)).toBeNull();
  });

  it("forgets a draft that is emptied, and ignores one that is malformed", () => {
    saveQuickAddDraft(1, draft("Call the dentist"));
    saveQuickAddDraft(1, draft("   "));
    expect(sessionStorage.length).toBe(0);

    sessionStorage.setItem("tuktuk.quickAddDraft.1", "{not json");
    expect(loadQuickAddDraft(1)).toBeNull();
    sessionStorage.setItem("tuktuk.quickAddDraft.1", JSON.stringify({ title: 3 }));
    expect(loadQuickAddDraft(1)).toBeNull();
  });

  it("ignores a draft whose priority is not one the app knows", () => {
    const stored = { ...draft("Call the dentist"), priorityChosen: true };
    sessionStorage.setItem(
      "tuktuk.quickAddDraft.1",
      JSON.stringify({ ...stored, priority: "urgent" }),
    );
    expect(loadQuickAddDraft(1)).toBeNull();

    sessionStorage.setItem(
      "tuktuk.quickAddDraft.1",
      JSON.stringify({ ...stored, priority: "high" }),
    );
    expect(loadQuickAddDraft(1)).toEqual({ ...stored, priority: "high" });
  });

  it("never throws when storage does", () => {
    for (const method of ["getItem", "setItem", "removeItem", "key"] as const) {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new DOMException("Access denied", "SecurityError");
      });
    }

    expect(() => saveQuickAddDraft(1, draft("Call the dentist"))).not.toThrow();
    expect(loadQuickAddDraft(1)).toBeNull();
    expect(() => clearQuickAddDraft(1)).not.toThrow();
  });
});
