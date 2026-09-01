/** Quick-Add token parsing: `#tag`, `!priority` and `~list`, parsed
 * deterministically and stripped from the saved title. No natural-language
 * date parsing in v1 (see the PRD).
 */

import { type Priority, type TaskList } from "./api";
import { resolveDayToken, type ScheduleChip } from "./dateSuggest";

export interface QuickAddPlan {
  /** The input with all consumed tokens stripped (whitespace collapsed). */
  title: string;
  /** From the first `!high` / `!medium` / `!low` token, or null. */
  priority: Priority | null;
  /** From the first `~name` token matching a List, or null. */
  listId: number | null;
  /** `#tag` names in first-seen order, deduplicated case-insensitively. */
  tagNames: string[];
  /** From the first recognised `@day` token, resolved against `options.now`
   * — null when no `now` was supplied (date tokens are then left in the
   * title untouched) or no token resolved. */
  due: ScheduleChip | null;
}

const PRIORITY_TOKENS: Record<string, Priority> = {
  "!high": "high",
  "!medium": "medium",
  "!low": "low",
};

/** Case-insensitive name equality — how tokens match Lists and Tags. */
export const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

export interface ParseQuickAddOptions {
  /** True once a `~list` chip has already been picked from the dropdown —
   * the deliberate pick wins, so a raw `~token` is left in the title
   * untouched rather than silently claiming the slot too. */
  skipListToken?: boolean;
  /** Same, for a `!priority` chip already picked from the dropdown. */
  skipPriorityToken?: boolean;
  /** Same, for an `@day` schedule chip already picked from the dropdown. */
  skipDateToken?: boolean;
  /** The clock `@day` tokens resolve against. Absent (the palette, the
   * Quick-Add dialog, the calendar draft — all of which carry their own
   * date) means `@day` tokens are left in the title verbatim, exactly as
   * before this sigil existed. */
  now?: Date;
}

/** Tokens are consumed at most once (first wins); anything not consumed —
 * unknown `!word`, unmatched or repeated `~list` — stays in the title
 * verbatim, so nothing typed is silently lost. */
export function parseQuickAdd(
  input: string,
  lists: TaskList[],
  options: ParseQuickAddOptions = {},
): QuickAddPlan {
  const plan: QuickAddPlan = { title: "", priority: null, listId: null, tagNames: [], due: null };
  const rest: string[] = [];
  for (const word of input.split(/\s+/)) {
    if (word.startsWith("#") && word.length > 1) {
      const name = word.slice(1);
      if (!plan.tagNames.some((seen) => sameName(seen, name))) {
        plan.tagNames.push(name);
      }
      continue;
    }
    if (!options.skipPriorityToken) {
      const priority = PRIORITY_TOKENS[word.toLowerCase()];
      if (priority !== undefined && plan.priority === null) {
        plan.priority = priority;
        continue;
      }
    }
    if (
      options.now !== undefined &&
      !options.skipDateToken &&
      word.startsWith("@") &&
      word.length > 1 &&
      plan.due === null
    ) {
      const resolved = resolveDayToken(word.slice(1), options.now);
      if (resolved !== null) {
        plan.due = resolved;
        continue;
      }
    }
    if (!options.skipListToken && word.startsWith("~") && word.length > 1 && plan.listId === null) {
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
