import { useState } from "react";

import { createTag, createTask, type Tag, type Task, type TaskList } from "../api";
import { parseQuickAdd, sameName } from "../quickAdd";

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

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const plan = parseQuickAdd(title, lists);
    if (plan.title === "") {
      return;
    }
    // Unknown #tag names create the Tag on the fly; known ones match
    // case-insensitively.
    const tagIds: number[] = [];
    for (const name of plan.tagNames) {
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
    setTitle("");
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <input
        aria-label="Add a task"
        placeholder="Add a task…"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
    </form>
  );
}
