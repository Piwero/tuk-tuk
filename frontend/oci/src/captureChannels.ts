/** The four `TokenInput` capture channels — `#tag`, `~list`, `!priority`
 * and `@date` — built once here instead of re-spelled in every consumer.
 *
 * Four surfaces drive a capture `TokenInput`: the Quick-Add bar, the
 * Quick-Add dialog, the Command Palette "New task" row, and the Calendar
 * view's inline draft (the first three take all four channels; the
 * calendar draft takes the first three — it owns its own schedule, see
 * ADR 0011). Every one of them wants the *same* sigil, mode, suggestion
 * lookup, pick splice and labels; they differ only in where the picked
 * chips live (component state, a derived slice of `listId`/`tagIds`, …)
 * and — for `#tag` / `~list` — what to do once a "Create …" row makes a
 * new Tag or List. Those are the factory arguments; nothing else varies.
 */

import { createList, createTag, type Priority, type Tag, type TaskList } from "./api";
import {
  applyDatePick,
  formatScheduleChipLabel,
  mergeSchedule,
  type ScheduleChip,
  suggestDates,
} from "./dateSuggest";
import { browserTimeZone } from "./dates";
import { PRIORITY_LABELS } from "./grouping";
import { applyListPick, suggestLists } from "./listSuggest";
import { applyPriorityPick, suggestPriority } from "./prioritySuggest";
import { applyTagPick, suggestTags } from "./tagSuggest";
import { type TokenChannel } from "./components/TokenInput";

/** The `#tag` channel — multi-valued, and the "Create …" row really
 * creates a Tag (`onCreated` then lets app state pick it up). */
export function makeTagChannel(
  tags: Tag[],
  chips: Tag[],
  onChipsChange: (chips: Tag[]) => void,
  onCreated: (tag: Tag) => void,
): TokenChannel<Tag> {
  return {
    sigil: "#",
    mode: "multi",
    chips,
    onChipsChange,
    getId: (tag) => tag.id,
    getLabel: (tag) => tag.name,
    suggest: (text, caret) => suggestTags(text, caret, tags),
    applyPick: applyTagPick,
    allowCreate: true,
    onCreate: (name) => createTag({ name }),
    onCreated,
    createLabel: (name) => `Create tag "${name}"`,
    removeAriaLabel: (tag) => `Remove ${tag.name}`,
  };
}

/** The `~list` channel — single-valued, and the "Create …" row really
 * creates a List. */
export function makeListChannel(
  lists: TaskList[],
  chips: TaskList[],
  onChipsChange: (chips: TaskList[]) => void,
  onCreated: (list: TaskList) => void,
): TokenChannel<TaskList> {
  return {
    sigil: "~",
    mode: "single",
    chips,
    onChipsChange,
    getId: (list) => list.id,
    getLabel: (list) => list.name,
    suggest: (text, caret) => suggestLists(text, caret, lists),
    applyPick: applyListPick,
    allowCreate: true,
    onCreate: (name) => createList({ name }),
    onCreated,
    createLabel: (name) => `Create list "${name}"`,
    removeAriaLabel: (list) => `Remove ${list.name}`,
  };
}

/** The `!priority` channel — single-valued over a closed set, so no
 * "Create …" row. */
export function makePriorityChannel(
  chips: Priority[],
  onChipsChange: (chips: Priority[]) => void,
): TokenChannel<Priority> {
  return {
    sigil: "!",
    mode: "single",
    chips,
    onChipsChange,
    getId: (priority) => priority,
    getLabel: (priority) => PRIORITY_LABELS[priority],
    suggest: (text, caret) => suggestPriority(text, caret),
    applyPick: applyPriorityPick,
    allowCreate: false,
    createLabel: (name) => name,
    removeAriaLabel: (priority) => `Remove ${priority}`,
  };
}

/** The `@date` channel — single-valued, and the one channel that composes
 * a pick onto the standing chip (`mergePick`) rather than replacing it, so
 * a picked day and a typed time build one schedule. Resolves against
 * `now`, which the caller freezes for its input's lifetime so the dropdown
 * and the commit-time parse agree on "today". */
export function makeDateChannel(
  chips: ScheduleChip[],
  onChipsChange: (chips: ScheduleChip[]) => void,
  now: Date,
): TokenChannel<ScheduleChip> {
  return {
    sigil: "@",
    mode: "single",
    chips,
    onChipsChange,
    getId: (schedule) => schedule.token,
    getLabel: formatScheduleChipLabel,
    suggest: (text, caret) => suggestDates(text, caret, now, browserTimeZone()),
    applyPick: applyDatePick,
    mergePick: (current, incoming) => mergeSchedule(current, incoming, browserTimeZone()),
    allowCreate: false,
    createLabel: (name) => name,
    removeAriaLabel: () => "Remove schedule",
  };
}
