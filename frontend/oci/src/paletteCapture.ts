/** Command-palette Task capture (issue #204): turns the palette's typed
 * text plus whatever chips have been picked from the sigil dropdowns into a
 * preview (shown back as chips before it commits) and, when there's a title
 * to save, the exact payload for `createTask`.
 *
 * The `#tag` / `!priority` / `~list` sigils parse with the very same
 * `parseQuickAdd` the Quick-Add capture bar uses — this module never
 * reimplements token parsing. Unlike Quick-Add, an unpicked token never
 * brings a new List or Tag into being here: a raw `#foo` that matches no
 * existing Tag is shown as an (unmatched) chip and then dropped on commit,
 * and a raw `~foo` that matches no List simply stays in the title. The
 * "Create …" row in the dropdown is the only path to a new List or Tag. */

import { type Priority, type Tag, type TaskList } from "./api";
import { resolveTokenSchedule, type ScheduleChip } from "./dateSuggest";
import { browserTimeZone } from "./dates";
import { parseQuickAdd, sameName } from "./quickAdd";

export interface CaptureTagChip {
  name: string;
  /** The existing Tag's id, or null when nothing matches — an unmatched
   * chip is shown so a mistype is visible, but never created on commit. */
  tagId: number | null;
}

export interface CapturePreview {
  /** The typed text with every consumed token stripped. */
  title: string;
  priority: Priority | null;
  list: { id: number; name: string } | null;
  tags: CaptureTagChip[];
  /** The resolved `@day` / `@time` schedule, shown back as a chip. Null
   * when no `@` token (or picked chip) scheduled it. */
  schedule: ScheduleChip | null;
  /** False until there's a non-empty title — nothing to commit yet. */
  ready: boolean;
}

export interface CaptureCommit {
  title: string;
  listId: number;
  priority: Priority | null;
  tagIds: number[];
}

export interface CaptureChips {
  tags: Tag[];
  list: TaskList[];
  priority: Priority[];
  schedule: ScheduleChip[];
}

export interface CapturePlan {
  preview: CapturePreview;
  /** The `createTask` payload, or null when there's no title to save. The
   * resolved `@` schedule rides on `preview.schedule` rather than here, so
   * the payload shape stays stable for callers that compare it. */
  commit: CaptureCommit | null;
}

export function planPaletteCapture(
  text: string,
  chips: CaptureChips,
  lists: TaskList[],
  tags: Tag[],
  defaultListId: number,
  now: Date,
): CapturePlan {
  // A deliberately-picked chip wins over a same-named raw token, and that
  // token is left in the title rather than silently consumed too — exactly
  // the Quick-Add rule.
  const plan = parseQuickAdd(text, lists, {
    skipListToken: chips.list.length > 0,
    skipPriorityToken: chips.priority.length > 0,
    skipDateToken: chips.schedule.length > 0,
    now,
  });

  // A picked `@` chip owns the day; a raw `@8am` still composes its time
  // half onto it — the same resolution the Quick-Add bar uses (ADR 0011).
  const schedule = resolveTokenSchedule(
    chips.schedule[0],
    plan.due,
    plan.dueTime,
    browserTimeZone(),
  );

  const tagChips: CaptureTagChip[] = [];
  const seen: string[] = [];
  for (const chip of chips.tags) {
    if (!seen.some((name) => sameName(name, chip.name))) {
      seen.push(chip.name);
      tagChips.push({ name: chip.name, tagId: chip.id });
    }
  }
  for (const name of plan.tagNames) {
    if (seen.some((seenName) => sameName(seenName, name))) {
      continue;
    }
    seen.push(name);
    const existing = tags.find((tag) => sameName(tag.name, name));
    tagChips.push({ name, tagId: existing?.id ?? null });
  }

  const priority = chips.priority[0] ?? plan.priority ?? null;
  const pickedList = chips.list[0] ?? null;
  const parsedList =
    plan.listId === null ? null : (lists.find((list) => list.id === plan.listId) ?? null);
  const list = pickedList ?? parsedList;

  const preview: CapturePreview = {
    title: plan.title,
    priority,
    list: list === null ? null : { id: list.id, name: list.name },
    tags: tagChips,
    schedule,
    ready: plan.title !== "",
  };

  const commit: CaptureCommit | null = preview.ready
    ? {
        title: plan.title,
        listId: list?.id ?? defaultListId,
        priority,
        tagIds: tagChips
          .filter((tag): tag is CaptureTagChip & { tagId: number } => tag.tagId !== null)
          .map((tag) => tag.tagId),
      }
    : null;

  return { preview, commit };
}
