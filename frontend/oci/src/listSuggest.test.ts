import { describe, expect, it } from "vitest";

import { applyListPick, suggestLists, type ListSuggestion } from "./listSuggest";
import { fakeList } from "./test/fakeApi";

describe("suggestLists", () => {
  it("lists every list for a bare ~ with no query", () => {
    const work = fakeList("Work");
    const home = fakeList("Home");
    const suggestion = suggestLists("~", 1, [work, home]);
    expect(suggestion).toEqual({
      sigil: "~",
      start: 0,
      query: "",
      options: [work, home],
      create: null,
    });
  });

  it("narrows by case-insensitive prefix on the list name", () => {
    const work = fakeList("Work");
    const workout = fakeList("Workout");
    const home = fakeList("Home");
    const suggestion = suggestLists("~wo", 3, [work, workout, home]);
    expect(suggestion?.query).toBe("wo");
    expect(suggestion?.options).toEqual([work, workout]);
  });

  it("finds a multi-word list name by its first word", () => {
    const personalErrands = fakeList("Personal Errands");
    const suggestion = suggestLists("~personal", 9, [personalErrands]);
    expect(suggestion?.options).toEqual([personalErrands]);
  });

  it("stays inert when the sigil follows a non-whitespace character", () => {
    const suggestion = suggestLists("a~b", 3, []);
    expect(suggestion).toBeNull();
  });

  it("closes once a space ends the query", () => {
    const work = fakeList("Work");
    const suggestion = suggestLists("~work ", 6, [work]);
    expect(suggestion).toBeNull();
  });

  it("offers to create the query when no list matches it exactly", () => {
    const work = fakeList("Work");
    const suggestion = suggestLists("~zzz", 4, [work]);
    expect(suggestion?.create).toBe("zzz");
  });

  it("offers nothing to create when the query is empty", () => {
    const work = fakeList("Work");
    const suggestion = suggestLists("~", 1, [work]);
    expect(suggestion?.create).toBeNull();
  });

  it("offers nothing to create when a list already matches the query exactly, case-insensitively", () => {
    const work = fakeList("Work");
    const suggestion = suggestLists("~WORK", 5, [work]);
    expect(suggestion?.create).toBeNull();
  });
});

describe("applyListPick", () => {
  it("removes the sigil+query text and reports the committed list", () => {
    const work = fakeList("Work");
    const suggestion: ListSuggestion = {
      sigil: "~",
      start: 5,
      query: "wo",
      options: [work],
      create: null,
    };
    const result = applyListPick("file ~wo", suggestion, work);
    expect(result).toEqual({ text: "file ", caret: 5, list: work });
  });

  it("leaves text after the caret untouched", () => {
    const work = fakeList("Work");
    const suggestion: ListSuggestion = {
      sigil: "~",
      start: 0,
      query: "wo",
      options: [work],
      create: null,
    };
    const result = applyListPick("~work #fun", suggestion, work);
    expect(result).toEqual({ text: "rk #fun", caret: 0, list: work });
  });
});
