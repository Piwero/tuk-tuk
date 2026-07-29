import { useState } from "react";

import {
  createList,
  createTag,
  createTask,
  type Priority,
  type Tag,
  type Task,
  type TaskList,
} from "../api";
import { PRIORITY_LABELS } from "../grouping";
import { applyListPick, suggestLists } from "../listSuggest";
import { applyPriorityPick, suggestPriority } from "../prioritySuggest";
import { parseQuickAdd, sameName } from "../quickAdd";
import { applyTagPick, suggestTags } from "../tagSuggest";
import { TokenInput, type TokenChannel } from "./TokenInput";

interface QuickAddProps {
  /** The viewed List — the default target when no `~list` token or chip
   * names one. */
  listId: number;
  lists: TaskList[];
  tags: Tag[];
  onTagCreated: (tag: Tag) => void;
  onListCreated: (list: TaskList) => void;
  onCreated: (task: Task) => void;
}

export function QuickAdd({
  listId,
  lists,
  tags,
  onTagCreated,
  onListCreated,
  onCreated,
}: QuickAddProps): JSX.Element {
  const [title, setTitle] = useState("");
  const [tagChips, setTagChips] = useState<Tag[]>([]);
  const [listChip, setListChip] = useState<TaskList[]>([]);
  const [priorityChip, setPriorityChip] = useState<Priority[]>([]);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    // A chip is a deliberate pick — it wins over a same-named raw token, and
    // that token is left in the title rather than silently consumed too.
    const plan = parseQuickAdd(title, lists, {
      skipListToken: listChip.length > 0,
      skipPriorityToken: priorityChip.length > 0,
    });
    if (plan.title === "") {
      return;
    }
    // Snapshots so a chip or title edit made while this submission is still
    // awaiting the network isn't wiped out by the reset below.
    const submittedTitle = title;
    const submittedTagChips = tagChips;
    const submittedListChip = listChip;
    const submittedPriorityChip = priorityChip;
    // Chips and any raw #tokens left in the title are unioned and
    // deduplicated case-insensitively by name — a chip and a typed token can
    // both name the same tag. Unknown names create the Tag on the fly.
    const tagIds: number[] = [];
    const seen: string[] = [];
    for (const chip of tagChips) {
      if (!seen.some((name) => sameName(name, chip.name))) {
        seen.push(chip.name);
        tagIds.push(chip.id);
      }
    }
    for (const name of plan.tagNames) {
      if (seen.some((seenName) => sameName(seenName, name))) {
        continue;
      }
      seen.push(name);
      const existing = tags.find((tag) => sameName(tag.name, name));
      if (existing !== undefined) {
        tagIds.push(existing.id);
      } else {
        const created = await createTag({ name });
        onTagCreated(created);
        tagIds.push(created.id);
      }
    }
    const finalListId = listChip[0]?.id ?? plan.listId ?? listId;
    const finalPriority = priorityChip[0] ?? plan.priority;
    const task = await createTask({
      title: plan.title,
      list_id: finalListId,
      ...(finalPriority === null || finalPriority === undefined ? {} : { priority: finalPriority }),
      ...(tagIds.length === 0 ? {} : { tag_ids: tagIds }),
    });
    onCreated(task);
    setTitle((current) => (current === submittedTitle ? "" : current));
    setTagChips((current) => (current === submittedTagChips ? [] : current));
    setListChip((current) => (current === submittedListChip ? [] : current));
    setPriorityChip((current) => (current === submittedPriorityChip ? [] : current));
  }

  const tagChannel: TokenChannel<Tag> = {
    sigil: "#",
    mode: "multi",
    chips: tagChips,
    onChipsChange: setTagChips,
    getId: (tag) => tag.id,
    getLabel: (tag) => tag.name,
    suggest: (text, caret) => suggestTags(text, caret, tags),
    applyPick: applyTagPick,
    allowCreate: true,
    onCreate: (name) => createTag({ name }),
    onCreated: onTagCreated,
    createLabel: (name) => `Create tag "${name}"`,
    removeAriaLabel: (tag) => `Remove ${tag.name}`,
  };

  const listChannel: TokenChannel<TaskList> = {
    sigil: "~",
    mode: "single",
    chips: listChip,
    onChipsChange: setListChip,
    getId: (list) => list.id,
    getLabel: (list) => list.name,
    suggest: (text, caret) => suggestLists(text, caret, lists),
    applyPick: applyListPick,
    allowCreate: true,
    onCreate: (name) => createList({ name }),
    onCreated: onListCreated,
    createLabel: (name) => `Create list "${name}"`,
    removeAriaLabel: (list) => `Remove ${list.name}`,
  };

  const priorityChannel: TokenChannel<Priority> = {
    sigil: "!",
    mode: "single",
    chips: priorityChip,
    onChipsChange: setPriorityChip,
    getId: (priority) => priority,
    getLabel: (priority) => PRIORITY_LABELS[priority],
    suggest: (text, caret) => suggestPriority(text, caret),
    applyPick: applyPriorityPick,
    allowCreate: false,
    createLabel: (name) => name,
    removeAriaLabel: (priority) => `Remove ${priority}`,
  };

  return (
    <form onSubmit={(event) => void submit(event)}>
      <TokenInput
        ariaLabel="Add a task"
        placeholder="Add a task…"
        value={title}
        onValueChange={setTitle}
        channels={[
          tagChannel as TokenChannel<unknown>,
          listChannel as TokenChannel<unknown>,
          priorityChannel as TokenChannel<unknown>,
        ]}
      />
    </form>
  );
}
