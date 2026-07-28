import { useState } from "react";

import { createTag, createTask, type Priority, type Tag, type Task, type TaskList } from "../api";
import {
  addDays,
  emptyDraft,
  localDayOf,
  nextMonday,
  scheduleForCreate,
  scheduleFromDraft,
  type DateDraft,
} from "../dates";
import { PRIORITY_LABELS } from "../grouping";
import { sameName } from "../quickAdd";
import { DateFieldset } from "./DateFieldset";

interface QuickAddDialogProps {
  lists: TaskList[];
  tags: Tag[];
  /** The viewed List, or null on a view that isn't one List (Inbox then). */
  defaultListId: number | null;
  onTagCreated: (tag: Tag) => void;
  onCreated: (task: Task) => void;
  onClose: () => void;
}

/** The full capture form behind the header's Quick add button: everything the
 * one-line Quick-Add bar can't express, filled in before the task exists.
 *
 * Unlike the bar, the title is plain text — the explicit fields replace the
 * `#tag` / `!priority` / `~list` tokens, and honouring both would be ambiguous. */
export function QuickAddDialog({
  lists,
  tags,
  defaultListId,
  onTagCreated,
  onCreated,
  onClose,
}: QuickAddDialogProps): JSX.Element {
  const inboxId = lists.find((list) => list.is_inbox)?.id ?? lists[0]?.id ?? null;
  const [title, setTitle] = useState("");
  const [listId, setListId] = useState<number | null>(defaultListId ?? inboxId);
  const [priority, setPriority] = useState<Priority>("none");
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [newTag, setNewTag] = useState("");
  const [dateDraft, setDateDraft] = useState<DateDraft>(emptyDraft);

  /** A quick pick sets the day and leaves the times alone — an untimed day is
   * an all-day task, exactly as in the detail panel. */
  function pickDay(dayIso: string): void {
    setDateDraft((current) => ({ ...current, dueDay: dayIso }));
  }

  function toggleTag(tagId: number): void {
    setTagIds((current) =>
      current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId],
    );
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed === "") {
      return;
    }
    // A typed name that matches nothing creates the Tag first — the same
    // on-the-fly rule the Quick-Add bar applies to an unknown #tag.
    const chosen = [...tagIds];
    const wanted = newTag.trim();
    if (wanted !== "") {
      const existing = tags.find((tag) => sameName(tag.name, wanted));
      if (existing !== undefined) {
        if (!chosen.includes(existing.id)) {
          chosen.push(existing.id);
        }
      } else {
        const created = await createTag({ name: wanted });
        onTagCreated(created);
        chosen.push(created.id);
      }
    }
    const schedule = scheduleFromDraft(dateDraft);
    const task = await createTask({
      title: trimmed,
      ...(listId === null ? {} : { list_id: listId }),
      ...(priority === "none" ? {} : { priority }),
      ...(chosen.length === 0 ? {} : { tag_ids: chosen }),
      ...(schedule === null ? {} : scheduleForCreate(schedule)),
    });
    onCreated(task);
    onClose();
  }

  return (
    <form className="quick-add-dialog" onSubmit={(event) => void submit(event)}>
      <label>
        Title
        <input
          aria-label="Title"
          placeholder="What needs doing?"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          autoFocus
        />
      </label>
      <label>
        List
        <select
          aria-label="List"
          value={listId ?? ""}
          onChange={(event) => setListId(Number(event.target.value))}
        >
          {lists.map((list) => (
            <option key={list.id} value={list.id}>
              {list.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Priority
        <select
          aria-label="Priority"
          value={priority}
          onChange={(event) => setPriority(event.target.value as Priority)}
        >
          {(Object.keys(PRIORITY_LABELS) as Priority[]).map((level) => (
            <option key={level} value={level}>
              {PRIORITY_LABELS[level]}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="quick-add-dates">
        <legend>Date</legend>
        <div className="date-actions">
          <button type="button" onClick={() => pickDay(localDayOf(new Date()))}>
            Today
          </button>
          <button type="button" onClick={() => pickDay(addDays(localDayOf(new Date()), 1))}>
            Tomorrow
          </button>
          <button type="button" onClick={() => pickDay(nextMonday(localDayOf(new Date())))}>
            Next Week
          </button>
          <button type="button" onClick={() => setDateDraft(emptyDraft())}>
            Clear date
          </button>
        </div>
        <DateFieldset draft={dateDraft} onChange={setDateDraft} />
      </fieldset>
      <fieldset className="quick-add-tags">
        <legend>Tags</legend>
        {tags.map((tag) => (
          <label key={tag.id}>
            <input
              type="checkbox"
              aria-label={tag.name}
              checked={tagIds.includes(tag.id)}
              onChange={() => toggleTag(tag.id)}
            />
            {tag.name}
          </label>
        ))}
        <label>
          New tag
          <input
            aria-label="New tag"
            placeholder="Create a tag…"
            value={newTag}
            onChange={(event) => setNewTag(event.target.value)}
          />
        </label>
      </fieldset>
      <div className="quick-add-dialog-actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="submit">Add task</button>
      </div>
    </form>
  );
}
