/** Quick-Add `!priority` suggestion dropdown: pure text/caret logic, the
 * same shape as `tagSuggest.ts`'s `#tag` module. The set of levels is
 * closed — there is never a create row, unlike `#tag` and `~list`. */

import { type Priority } from "./api";
import { type SigilPosition, wordStart } from "./sigilText";

/** The four Priority levels minus "none" (there is no `!none` token),
 * high-to-low — the order the dropdown lists them in. */
export const PRIORITY_LEVELS: Priority[] = ["high", "medium", "low"];

export interface PrioritySuggestion {
  sigil: "!";
  /** Index of the sigil character itself. */
  start: number;
  /** Text typed after the sigil, up to the caret. */
  query: string;
  /** Levels whose name starts with `query`, case-insensitively. */
  options: Priority[];
  /** Always null — the set of levels is closed, nothing can be created. */
  create: null;
}

/** Locates the `!` token the caret sits inside, if any, and the levels
 * whose name matches what's been typed so far. A sigil only opens a query
 * at the start of the input or right after whitespace, and a space (moving
 * the caret past it) ends the query. */
export function suggestPriority(text: string, caret: number): PrioritySuggestion | null {
  const start = wordStart(text, caret);
  if (text[start] !== "!" || caret <= start) {
    return null;
  }
  const query = text.slice(start + 1, caret);
  const options = PRIORITY_LEVELS.filter((level) => level.startsWith(query.toLowerCase()));
  return { sigil: "!", start, query, options, create: null };
}

export interface PriorityPick {
  /** The input text with the sigil and typed query removed. */
  text: string;
  /** Caret position after the removal — where the sigil used to start. */
  caret: number;
  /** The level committed as a chip. */
  priority: Priority;
}

/** Applies a pick: strips the `!query` text the suggestion matched, leaving
 * anything typed after the caret untouched. */
export function applyPriorityPick(
  text: string,
  suggestion: SigilPosition,
  priority: Priority,
): PriorityPick {
  const queryEnd = suggestion.start + 1 + suggestion.query.length;
  return {
    text: text.slice(0, suggestion.start) + text.slice(queryEnd),
    caret: suggestion.start,
    priority,
  };
}
