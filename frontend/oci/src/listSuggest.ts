/** Quick-Add `~list` suggestion dropdown: pure text/caret logic, the same
 * shape as `tagSuggest.ts`'s `#tag` module, kept separately unit-tested. */

import { type TaskList } from "./api";
import { sameName } from "./quickAdd";
import { type SigilPosition, wordStart } from "./sigilText";

export interface ListSuggestion {
  sigil: "~";
  /** Index of the sigil character itself. */
  start: number;
  /** Text typed after the sigil, up to the caret. */
  query: string;
  /** Lists whose name starts with `query`, case-insensitively. */
  options: TaskList[];
  /** The query, offered for creation as a new list — null when the query is
   * empty or a list already matches it exactly, case-insensitively. */
  create: string | null;
}

/** Locates the `~` token the caret sits inside, if any, and the lists whose
 * name matches what's been typed so far. A sigil only opens a query at the
 * start of the input or right after whitespace, and a space (moving the
 * caret past it) ends the query. */
export function suggestLists(
  text: string,
  caret: number,
  lists: TaskList[],
): ListSuggestion | null {
  const start = wordStart(text, caret);
  if (text[start] !== "~" || caret <= start) {
    return null;
  }
  const query = text.slice(start + 1, caret);
  const options = lists.filter((list) => sameName(list.name.slice(0, query.length), query));
  const create = query !== "" && !lists.some((list) => sameName(list.name, query)) ? query : null;
  return { sigil: "~", start, query, options, create };
}

export interface ListPick {
  /** The input text with the sigil and typed query removed. */
  text: string;
  /** Caret position after the removal — where the sigil used to start. */
  caret: number;
  /** The list committed as a chip. */
  list: TaskList;
}

/** Applies a pick: strips the `~query` text the suggestion matched, leaving
 * anything typed after the caret untouched. */
export function applyListPick(text: string, suggestion: SigilPosition, list: TaskList): ListPick {
  const queryEnd = suggestion.start + 1 + suggestion.query.length;
  return {
    text: text.slice(0, suggestion.start) + text.slice(queryEnd),
    caret: suggestion.start,
    list,
  };
}
