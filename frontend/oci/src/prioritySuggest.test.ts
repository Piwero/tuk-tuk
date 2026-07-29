import { describe, expect, it } from "vitest";

import {
  applyPriorityPick,
  PRIORITY_LEVELS,
  suggestPriority,
  type PrioritySuggestion,
} from "./prioritySuggest";

describe("suggestPriority", () => {
  it("lists all three priority levels for a bare ! with no query", () => {
    const suggestion = suggestPriority("!", 1);
    expect(suggestion).toEqual({
      sigil: "!",
      start: 0,
      query: "",
      options: ["high", "medium", "low"],
      create: null,
    });
  });

  it("exposes the levels in high-to-low order", () => {
    expect(PRIORITY_LEVELS).toEqual(["high", "medium", "low"]);
  });

  it("narrows by case-insensitive prefix", () => {
    const suggestion = suggestPriority("!m", 2);
    expect(suggestion?.options).toEqual(["medium"]);
  });

  it("matches prefixes case-insensitively even when the query has different case", () => {
    const suggestion = suggestPriority("!HI", 3);
    expect(suggestion?.options).toEqual(["high"]);
  });

  it("returns no options when nothing matches the prefix, without offering to create", () => {
    const suggestion = suggestPriority("!zzz", 4);
    expect(suggestion).toEqual({
      sigil: "!",
      start: 0,
      query: "zzz",
      options: [],
      create: null,
    });
  });

  it("never offers a create row, even for an exact-looking miss", () => {
    const suggestion = suggestPriority("!hi", 3);
    expect(suggestion?.create).toBeNull();
  });

  it("stays inert when the sigil follows a non-whitespace character", () => {
    const suggestion = suggestPriority("a!b", 3);
    expect(suggestion).toBeNull();
  });

  it("closes once a space ends the query", () => {
    const suggestion = suggestPriority("!high ", 6);
    expect(suggestion).toBeNull();
  });

  it("opens immediately after whitespace", () => {
    const suggestion = suggestPriority("do !hi", 6);
    expect(suggestion).toEqual({
      sigil: "!",
      start: 3,
      query: "hi",
      options: ["high"],
      create: null,
    });
  });
});

describe("applyPriorityPick", () => {
  it("removes the sigil+query text and reports the committed level", () => {
    const suggestion: PrioritySuggestion = {
      sigil: "!",
      start: 3,
      query: "hi",
      options: ["high"],
      create: null,
    };
    const result = applyPriorityPick("do !hi", suggestion, "high");
    expect(result).toEqual({ text: "do ", caret: 3, priority: "high" });
  });

  it("leaves text after the caret untouched", () => {
    const suggestion: PrioritySuggestion = {
      sigil: "!",
      start: 0,
      query: "hi",
      options: ["high"],
      create: null,
    };
    const result = applyPriorityPick("!high #fun", suggestion, "high");
    expect(result).toEqual({ text: "gh #fun", caret: 0, priority: "high" });
  });
});
