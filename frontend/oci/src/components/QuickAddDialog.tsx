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
import { applyListPick, suggestLists } from "../listSuggest";
import { applyPriorityPick, suggestPriority } from "../prioritySuggest";
import { parseQuickAdd, sameName } from "../quickAdd";
import { applyTagPick, suggestTags } from "../tagSuggest";
import { DateFieldset } from "./DateFieldset";
import { TokenInput, type TokenChannel } from "./TokenInput";

interface QuickAddDialogProps {
  lists: TaskList[];
  tags: Tag[];
  /** The viewed List, or null on a view that isn't one List (Inbox then). */
  defaultListId: number | null;
  onTagCreated: (tag: Tag) => void;
  onListCreated: (list: TaskList) => void;
  onCreated: (task: Task) => void;
  onClose: () => void;
}

/** The full capture form behind the header's Quick add button: everything the
 * one-line Quick-Add bar can't express, filled in before the task exists.
 *
 * The title takes the same `#tag` / `!priority` / `~list` tokens as the bar,
 * but a pick lands in this form's own List/Priority/Tags controls rather than
 * a chip row — one visible source of truth per field, so the two can't
 * disagree about what the task will be. */
export function QuickAddDialog({
  lists,
  tags,
  defaultListId,
  onTagCreated,
  onListCreated,
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
  // Whether the List / Priority now shown was chosen by the user — through
  // the select or a dropdown pick — rather than left at its default. A raw
  // `~list` / `!priority` token still sitting in the title only claims a
  // field that nobody chose, mirroring how a chip wins in the bar.
  const [listChosen, setListChosen] = useState(false);
  const [priorityChosen, setPriorityChosen] = useState(false);

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
    // Tokens typed but never picked from the dropdown are still honoured at
    // submit, exactly as in the bar — otherwise a fully-typed `~expenses`
    // would be saved as literal title text.
    const plan = parseQuickAdd(title, lists, {
      skipListToken: listChosen,
      skipPriorityToken: priorityChosen,
    });
    const trimmed = plan.title.trim();
    if (trimmed === "") {
      return;
    }
    // A typed name that matches nothing creates the Tag first — the same
    // on-the-fly rule the Quick-Add bar applies to an unknown #tag.
    const chosen = [...tagIds];
    for (const name of plan.tagNames) {
      const existing = tags.find((tag) => sameName(tag.name, name));
      if (existing !== undefined) {
        if (!chosen.includes(existing.id)) {
          chosen.push(existing.id);
        }
      } else {
        const created = await createTag({ name });
        onTagCreated(created);
        chosen.push(created.id);
      }
    }
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
    const finalListId = listChosen ? listId : (plan.listId ?? listId);
    const finalPriority = priorityChosen ? priority : (plan.priority ?? priority);
    const schedule = scheduleFromDraft(dateDraft);
    const task = await createTask({
      title: trimmed,
      ...(finalListId === null ? {} : { list_id: finalListId }),
      ...(finalPriority === "none" ? {} : { priority: finalPriority }),
      ...(chosen.length === 0 ? {} : { tag_ids: chosen }),
      ...(schedule === null ? {} : scheduleForCreate(schedule)),
    });
    onCreated(task);
    onClose();
  }

  // Each channel's "chips" are read straight off the form's own state, so a
  // pick is indistinguishable from having used the control by hand, and the
  // already-picked check the dropdown does still works.
  const tagChannel: TokenChannel<Tag> = {
    sigil: "#",
    mode: "multi",
    chips: tags.filter((tag) => tagIds.includes(tag.id)),
    onChipsChange: (chips) => setTagIds(chips.map((tag) => tag.id)),
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
    chips: lists.filter((list) => list.id === listId),
    onChipsChange: (chips) => {
      setListId(chips[0]?.id ?? null);
      setListChosen(true);
    },
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
    chips: priority === "none" ? [] : [priority],
    onChipsChange: (chips) => {
      setPriority(chips[0] ?? "none");
      setPriorityChosen(true);
    },
    getId: (level) => level,
    getLabel: (level) => PRIORITY_LABELS[level],
    suggest: (text, caret) => suggestPriority(text, caret),
    applyPick: applyPriorityPick,
    allowCreate: false,
    createLabel: (name) => name,
    removeAriaLabel: (level) => `Remove ${level}`,
  };

  return (
    <form className="quick-add-dialog" onSubmit={(event) => void submit(event)}>
      <label>
        Title
        <TokenInput
          ariaLabel="Title"
          placeholder="What needs doing?"
          value={title}
          onValueChange={setTitle}
          channels={[
            tagChannel as TokenChannel<unknown>,
            listChannel as TokenChannel<unknown>,
            priorityChannel as TokenChannel<unknown>,
          ]}
          showChips={false}
          autoFocus
        />
      </label>
      <label>
        List
        <select
          aria-label="List"
          value={listId ?? ""}
          onChange={(event) => {
            setListId(Number(event.target.value));
            setListChosen(true);
          }}
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
          onChange={(event) => {
            setPriority(event.target.value as Priority);
            setPriorityChosen(true);
          }}
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
