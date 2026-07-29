/** Quick-Add `#tag` suggestion dropdown: pure text/caret logic, kept separate
 * from rendering so every edge case is unit-tested directly. The
 * word-boundary sigil detection (`wordStart`, in `./sigilText`) is shared
 * with `listSuggest.ts` and `prioritySuggest.ts`. */

import { type Tag } from "./api";
import { sameName } from "./quickAdd";
import { type SigilPosition, wordStart } from "./sigilText";

export interface TagSuggestion {
  sigil: "#";
  /** Index of the sigil character itself. */
  start: number;
  /** Text typed after the sigil, up to the caret. */
  query: string;
  /** Tags whose name starts with `query`, case-insensitively. */
  options: Tag[];
  /** The query, offered for creation as a new tag — null when the query is
   * empty or a tag already matches it exactly, case-insensitively. */
  create: string | null;
}

/** Locates the `#` token the caret sits inside, if any, and the tags whose
 * name matches what's been typed so far. A sigil only opens a query at the
 * start of the input or right after whitespace — `C#` and `item#3` stay
 * inert — and a space (moving the caret past it) ends the query. */
export function suggestTags(text: string, caret: number, tags: Tag[]): TagSuggestion | null {
  const start = wordStart(text, caret);
  if (text[start] !== "#" || caret <= start) {
    return null;
  }
  const query = text.slice(start + 1, caret);
  const options = tags.filter((tag) => sameName(tag.name.slice(0, query.length), query));
  const create = query !== "" && !tags.some((tag) => sameName(tag.name, query)) ? query : null;
  return { sigil: "#", start, query, options, create };
}

export interface TagPick {
  /** The input text with the sigil and typed query removed. */
  text: string;
  /** Caret position after the removal — where the sigil used to start. */
  caret: number;
  /** The tag committed as a chip. */
  tag: Tag;
}

/** Applies a pick: strips the `#query` text the suggestion matched, leaving
 * anything typed after the caret untouched. */
export function applyTagPick(text: string, suggestion: SigilPosition, tag: Tag): TagPick {
  const queryEnd = suggestion.start + 1 + suggestion.query.length;
  return {
    text: text.slice(0, suggestion.start) + text.slice(queryEnd),
    caret: suggestion.start,
    tag,
  };
}
