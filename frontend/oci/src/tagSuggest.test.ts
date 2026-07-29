import { describe, expect, it } from "vitest";

import { applyTagPick, suggestTags, type TagSuggestion } from "./tagSuggest";
import { fakeTag } from "./test/fakeApi";

describe("suggestTags", () => {
  it("lists every tag for a bare # with no query", () => {
    const books = fakeTag("Books");
    const fun = fakeTag("Fun");
    const suggestion = suggestTags("#", 1, [books, fun]);
    expect(suggestion).toEqual({
      sigil: "#",
      start: 0,
      query: "",
      options: [books, fun],
      create: null,
    });
  });

  it("narrows by case-insensitive prefix on the tag name", () => {
    const books = fakeTag("Books");
    const boat = fakeTag("Boat");
    const fun = fakeTag("Fun");
    const suggestion = suggestTags("#bo", 3, [books, boat, fun]);
    expect(suggestion?.query).toBe("bo");
    expect(suggestion?.options).toEqual([books, boat]);
  });

  it("matches prefixes case-insensitively even when the query has different case", () => {
    const books = fakeTag("Books");
    const suggestion = suggestTags("#BO", 3, [books]);
    expect(suggestion?.options).toEqual([books]);
  });

  it("opens at the very start of the input", () => {
    const books = fakeTag("Books");
    const suggestion = suggestTags("#bo", 3, [books]);
    expect(suggestion?.start).toBe(0);
  });

  it("opens immediately after whitespace", () => {
    const books = fakeTag("Books");
    const suggestion = suggestTags("read #bo", 8, [books]);
    expect(suggestion).toEqual({
      sigil: "#",
      start: 5,
      query: "bo",
      options: [books],
      create: "bo",
    });
  });

  it("stays inert when the sigil follows a non-whitespace character (C#)", () => {
    const suggestion = suggestTags("C#", 2, []);
    expect(suggestion).toBeNull();
  });

  it("stays inert when the sigil is embedded mid-word (item#3)", () => {
    const suggestion = suggestTags("item#3", 6, []);
    expect(suggestion).toBeNull();
  });

  it("closes once a space ends the query", () => {
    const books = fakeTag("Books");
    // Caret sits right after the space that follows the token.
    const suggestion = suggestTags("#books ", 7, [books]);
    expect(suggestion).toBeNull();
  });

  it("is null when the caret sits outside any # token", () => {
    const suggestion = suggestTags("read a book", 5, []);
    expect(suggestion).toBeNull();
  });

  it("resolves the active token from the caret position, ignoring text typed later in the same token", () => {
    const books = fakeTag("Books");
    const fun = fakeTag("Fun");
    // Caret parked between "bo" and "oks" of "#books", with another token
    // later in the string — only the text up to the caret is the query.
    const suggestion = suggestTags("#books #fun", 3, [books, fun]);
    expect(suggestion).toEqual({
      sigil: "#",
      start: 0,
      query: "bo",
      options: [books],
      create: "bo",
    });
  });

  it("finds the # token the caret is inside, not the one at the end of the input", () => {
    const books = fakeTag("Books");
    const fun = fakeTag("Fun");
    // Caret parked inside "#books", well before the trailing "#fun".
    const suggestion = suggestTags("#books #fun", 5, [books, fun]);
    expect(suggestion?.start).toBe(0);
    expect(suggestion?.query).toBe("book");
  });

  it("returns no options (but stays open) when nothing matches the prefix", () => {
    const books = fakeTag("Books");
    const suggestion = suggestTags("#zzz", 4, [books]);
    expect(suggestion).toEqual({
      sigil: "#",
      start: 0,
      query: "zzz",
      options: [],
      create: "zzz",
    });
  });

  it("offers to create the query when no tag matches it exactly", () => {
    const books = fakeTag("Books");
    const suggestion = suggestTags("#bo", 3, [books]);
    expect(suggestion?.create).toBe("bo");
  });

  it("offers nothing to create when the query is empty", () => {
    const books = fakeTag("Books");
    const suggestion = suggestTags("#", 1, [books]);
    expect(suggestion?.create).toBeNull();
  });

  it("offers nothing to create when a tag already matches the query exactly", () => {
    const books = fakeTag("Books");
    const suggestion = suggestTags("#books", 6, [books]);
    expect(suggestion?.create).toBeNull();
  });

  it("offers nothing to create when the exact match differs only in case", () => {
    const books = fakeTag("Books");
    const suggestion = suggestTags("#BOOKS", 6, [books]);
    expect(suggestion?.create).toBeNull();
  });

  it("offers to create even when the query matches other tags by prefix only", () => {
    const boat = fakeTag("Boat");
    const books = fakeTag("Books");
    const suggestion = suggestTags("#bo", 3, [boat, books]);
    expect(suggestion?.options).toEqual([boat, books]);
    expect(suggestion?.create).toBe("bo");
  });
});

describe("applyTagPick", () => {
  it("removes the sigil+query text and reports the committed tag", () => {
    const books = fakeTag("Books");
    const suggestion: TagSuggestion = {
      sigil: "#",
      start: 5,
      query: "bo",
      options: [books],
      create: null,
    };
    const result = applyTagPick("read #bo", suggestion, books);
    expect(result).toEqual({ text: "read ", caret: 5, tag: books });
  });

  it("leaves text after the caret untouched", () => {
    const books = fakeTag("Books");
    const suggestion: TagSuggestion = {
      sigil: "#",
      start: 0,
      query: "bo",
      options: [books],
      create: null,
    };
    const result = applyTagPick("#books #fun", suggestion, books);
    // Only "#bo" (up to where the caret was) is removed; "oks #fun" survives.
    // Caret was at 3, matching the "caret mid-string" suggestTags case above.
    expect(result).toEqual({ text: "oks #fun", caret: 0, tag: books });
  });

  it("collapses a bare # at the start of the input to an empty string", () => {
    const books = fakeTag("Books");
    const suggestion: TagSuggestion = {
      sigil: "#",
      start: 0,
      query: "",
      options: [books],
      create: null,
    };
    const result = applyTagPick("#", suggestion, books);
    expect(result).toEqual({ text: "", caret: 0, tag: books });
  });
});
