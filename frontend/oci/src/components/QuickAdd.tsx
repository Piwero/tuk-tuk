import { useState } from "react";

import { createTag, createTask, type Tag, type Task, type TaskList } from "../api";
import { parseQuickAdd, sameName } from "../quickAdd";
import { TokenInput } from "./TokenInput";

interface QuickAddProps {
  /** The viewed List — the default target when no `~list` token matches. */
  listId: number;
  lists: TaskList[];
  tags: Tag[];
  onTagCreated: (tag: Tag) => void;
  onCreated: (task: Task) => void;
}

export function QuickAdd({
  listId,
  lists,
  tags,
  onTagCreated,
  onCreated,
}: QuickAddProps): JSX.Element {
  const [title, setTitle] = useState("");
  const [chips, setChips] = useState<Tag[]>([]);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const plan = parseQuickAdd(title, lists);
    if (plan.title === "") {
      return;
    }
    // Snapshots so a chip or title edit made while this submission is still
    // awaiting the network isn't wiped out by the reset below.
    const submittedTitle = title;
    const submittedChips = chips;
    // Chips and any raw #tokens left in the title are unioned and
    // deduplicated case-insensitively by name — a chip and a typed token can
    // both name the same tag. Unknown names create the Tag on the fly.
    const tagIds: number[] = [];
    const seen: string[] = [];
    for (const chip of chips) {
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
    const task = await createTask({
      title: plan.title,
      list_id: plan.listId ?? listId,
      ...(plan.priority === null ? {} : { priority: plan.priority }),
      ...(tagIds.length === 0 ? {} : { tag_ids: tagIds }),
    });
    onCreated(task);
    setTitle((current) => (current === submittedTitle ? "" : current));
    setChips((current) => (current === submittedChips ? [] : current));
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <TokenInput
        ariaLabel="Add a task"
        placeholder="Add a task…"
        value={title}
        onValueChange={setTitle}
        chips={chips}
        onChipsChange={setChips}
        tags={tags}
        onTagCreated={onTagCreated}
      />
    </form>
  );
}
