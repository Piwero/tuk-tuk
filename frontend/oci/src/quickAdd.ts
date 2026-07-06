/** Quick-Add token parsing: `#tag`, `!priority` and `~list`, parsed
 * deterministically and stripped from the saved title. No natural-language
 * date parsing in v1 (see the PRD).
 */

import { type Priority, type TaskList } from "./api";

export interface QuickAddPlan {
  /** The input with all consumed tokens stripped (whitespace collapsed). */
  title: string;
  /** From the first `!high` / `!medium` / `!low` token, or null. */
  priority: Priority | null;
  /** From the first `~name` token matching a List, or null. */
  listId: number | null;
  /** `#tag` names in first-seen order, deduplicated case-insensitively. */
  tagNames: string[];
}

const PRIORITY_TOKENS: Record<string, Priority> = {
  "!high": "high",
  "!medium": "medium",
  "!low": "low",
};

/** Case-insensitive name equality — how tokens match Lists and Tags. */
export const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Tokens are consumed at most once (first wins); anything not consumed —
 * unknown `!word`, unmatched or repeated `~list` — stays in the title
 * verbatim, so nothing typed is silently lost. */
export function parseQuickAdd(input: string, lists: TaskList[]): QuickAddPlan {
  const plan: QuickAddPlan = { title: "", priority: null, listId: null, tagNames: [] };
  const rest: string[] = [];
  for (const word of input.split(/\s+/)) {
    if (word.startsWith("#") && word.length > 1) {
      const name = word.slice(1);
      if (!plan.tagNames.some((seen) => sameName(seen, name))) {
        plan.tagNames.push(name);
      }
      continue;
    }
    const priority = PRIORITY_TOKENS[word.toLowerCase()];
    if (priority !== undefined && plan.priority === null) {
      plan.priority = priority;
      continue;
    }
    if (word.startsWith("~") && word.length > 1 && plan.listId === null) {
      const match = lists.find((list) => sameName(list.name, word.slice(1)));
      if (match !== undefined) {
        plan.listId = match.id;
        continue;
      }
    }
    if (word !== "") {
      rest.push(word);
    }
  }
  plan.title = rest.join(" ");
  return plan;
}
