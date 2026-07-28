import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";

import {
  createCheckItem,
  deleteCheckItem,
  updateCheckItem,
  updateTask,
  type CheckItem,
  type Priority,
  type Tag,
  type Task,
} from "../api";
import {
  addDays,
  allDaySchedule,
  clearedSchedule,
  draftFrom,
  formatSchedule,
  isOverdue,
  localDayOf,
  nextMonday,
  scheduleFromDraft,
  type DateDraft,
} from "../dates";
import { readDragPayload, startDrag } from "../dnd";
import { PRIORITY_LABELS } from "../grouping";
import { appendOrder, planInsertBefore } from "../ordering";
import { customOffset, reminderLabel, REMINDER_PRESETS, type OffsetUnit } from "../reminders";
import { DateFieldset } from "./DateFieldset";
import { RepeatFieldset } from "./RepeatFieldset";
import { Icon } from "./Icon";

interface TaskDetailProps {
  task: Task;
  allTags: Tag[];
  onTaskChanged: (task: Task) => void;
  onClose: () => void;
}

export function TaskDetail({
  task,
  allTags,
  onTaskChanged,
  onClose,
}: TaskDetailProps): JSX.Element {
  const [title, setTitle] = useState(task.title);
  const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null);
  const [dateDraft, setDateDraft] = useState<DateDraft | null>(null);
  const [offsetDraft, setOffsetDraft] = useState<{ amount: string; unit: OffsetUnit } | null>(null);
  const [newItemTitle, setNewItemTitle] = useState("");
  const [itemEditor, setItemEditor] = useState<{ id: number; title: string } | null>(null);

  useEffect(() => {
    setTitle(task.title);
    setDescriptionDraft(null);
    setDateDraft(null);
    setOffsetDraft(null);
  }, [task.id, task.title]);

  async function saveTitle(): Promise<void> {
    const trimmed = title.trim();
    if (trimmed === "" || trimmed === task.title) {
      setTitle(task.title);
      return;
    }
    onTaskChanged(await updateTask(task.id, { title: trimmed }));
  }

  async function saveDescription(): Promise<void> {
    if (descriptionDraft === null) {
      return;
    }
    onTaskChanged(await updateTask(task.id, { description: descriptionDraft }));
    setDescriptionDraft(null);
  }

  async function addCheckItem(): Promise<void> {
    const trimmed = newItemTitle.trim();
    if (trimmed === "") {
      return;
    }
    onTaskChanged(await createCheckItem(task.id, trimmed));
    setNewItemTitle("");
  }

  async function tickCheckItem(item: CheckItem): Promise<void> {
    onTaskChanged(await updateCheckItem(task.id, item.id, { done: !item.done }));
  }

  async function toggleTag(tag: Tag): Promise<void> {
    const assigned = task.tags.some((t) => t.id === tag.id);
    const tagIds = assigned
      ? task.tags.filter((t) => t.id !== tag.id).map((t) => t.id)
      : [...task.tags.map((t) => t.id), tag.id];
    onTaskChanged(await updateTask(task.id, { tag_ids: tagIds }));
  }

  async function quickPick(dueDay: string): Promise<void> {
    onTaskChanged(await updateTask(task.id, allDaySchedule(null, dueDay)));
    setDateDraft(null);
  }

  async function clearSchedule(): Promise<void> {
    onTaskChanged(await updateTask(task.id, clearedSchedule()));
    setDateDraft(null);
  }

  async function addReminder(offset: string): Promise<void> {
    if (!task.reminders.includes(offset)) {
      onTaskChanged(await updateTask(task.id, { reminders: [...task.reminders, offset] }));
    }
    setOffsetDraft(null);
  }

  async function removeReminder(offset: string): Promise<void> {
    onTaskChanged(
      await updateTask(task.id, {
        reminders: task.reminders.filter((existing) => existing !== offset),
      }),
    );
  }

  async function addCustomReminder(): Promise<void> {
    if (offsetDraft === null) {
      return;
    }
    const amount = Number(offsetDraft.amount);
    if (!Number.isInteger(amount) || amount < 0) {
      return;
    }
    await addReminder(customOffset(amount, offsetDraft.unit));
  }

  async function saveDateDraft(): Promise<void> {
    if (dateDraft === null) {
      return;
    }
    const schedule = scheduleFromDraft(dateDraft);
    if (schedule === null) {
      return;
    }
    onTaskChanged(await updateTask(task.id, schedule));
    setDateDraft(null);
  }

  async function renameCheckItem(): Promise<void> {
    if (itemEditor === null) {
      return;
    }
    const trimmed = itemEditor.title.trim();
    if (trimmed !== "") {
      onTaskChanged(await updateCheckItem(task.id, itemEditor.id, { title: trimmed }));
    }
    setItemEditor(null);
  }

  async function removeCheckItem(item: CheckItem): Promise<void> {
    await deleteCheckItem(task.id, item.id);
    onTaskChanged({
      ...task,
      check_items: task.check_items.filter((i) => i.id !== item.id),
    });
  }

  async function moveCheckItemBefore(itemId: number, target: CheckItem): Promise<void> {
    const moved = task.check_items.find((i) => i.id === itemId);
    if (moved === undefined || itemId === target.id) {
      return;
    }
    const siblings = task.check_items.filter((i) => i.id !== itemId);
    const plan = planInsertBefore(siblings, moved, target.id);
    if (plan.kind === "single") {
      onTaskChanged(await updateCheckItem(task.id, itemId, { sort_order: plan.sort_order }));
      return;
    }
    // Gap exhausted: renumber the checklist; the last response carries the final order.
    let latest = task;
    for (const { row, sort_order } of plan.rows) {
      latest = await updateCheckItem(task.id, row.id, { sort_order });
    }
    onTaskChanged(latest);
  }

  function handleDropOnCheckItem(event: React.DragEvent, target: CheckItem): void {
    event.preventDefault();
    event.stopPropagation();
    const payload = readDragPayload(event);
    if (payload?.kind === "check-item") {
      void moveCheckItemBefore(payload.id, target);
    }
  }

  /** Dropping on the list itself (below the rows) moves the item to the end. */
  async function moveCheckItemToEnd(itemId: number): Promise<void> {
    const siblings = task.check_items.filter((i) => i.id !== itemId);
    if (siblings.length === task.check_items.length) {
      return;
    }
    onTaskChanged(await updateCheckItem(task.id, itemId, { sort_order: appendOrder(siblings) }));
  }

  function handleDropOnList(event: React.DragEvent): void {
    event.preventDefault();
    const payload = readDragPayload(event);
    if (payload?.kind === "check-item") {
      void moveCheckItemToEnd(payload.id);
    }
  }

  return (
    <aside className="task-detail" aria-label="Task details">
      <div className="task-detail-header">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void saveTitle();
          }}
        >
          <input
            aria-label="Task title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => void saveTitle()}
          />
        </form>
        <button type="button" aria-label="Close details" onClick={onClose}>
          <Icon name="x" />
        </button>
      </div>
      <label className="task-priority">
        Priority
        <select
          value={task.priority}
          onChange={(event) =>
            void updateTask(task.id, { priority: event.target.value as Priority }).then(
              onTaskChanged,
            )
          }
        >
          {(Object.keys(PRIORITY_LABELS) as Priority[]).map((level) => (
            <option key={level} value={level}>
              {PRIORITY_LABELS[level]}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="task-dates">
        <legend>Date</legend>
        {task.due_date !== null && dateDraft === null && (
          <p className={isOverdue(task) ? "date-label overdue" : "date-label"}>
            {formatSchedule(task)}
          </p>
        )}
        {dateDraft === null ? (
          <div className="date-actions">
            <button type="button" onClick={() => void quickPick(localDayOf(new Date()))}>
              Today
            </button>
            <button
              type="button"
              onClick={() => void quickPick(addDays(localDayOf(new Date()), 1))}
            >
              Tomorrow
            </button>
            <button
              type="button"
              onClick={() => void quickPick(nextMonday(localDayOf(new Date())))}
            >
              Next Week
            </button>
            <button
              type="button"
              aria-label="Custom date"
              onClick={() => setDateDraft(draftFrom(task))}
            >
              Custom…
            </button>
            {task.due_date !== null && (
              <button type="button" onClick={() => void clearSchedule()}>
                Clear date
              </button>
            )}
          </div>
        ) : (
          <div className="date-editor-actions">
            <DateFieldset draft={dateDraft} onChange={setDateDraft} />
            <button type="button" onClick={() => void saveDateDraft()}>
              Save date
            </button>
            <button type="button" onClick={() => setDateDraft(null)}>
              Cancel
            </button>
          </div>
        )}
      </fieldset>
      <fieldset className="task-reminders">
        <legend>Reminders</legend>
        {task.due_date === null ? (
          <p className="hint">Set a date to add Reminders.</p>
        ) : (
          <>
            {task.reminders.length > 0 && (
              <ul aria-label="Reminders">
                {task.reminders.map((offset) => (
                  <li key={offset}>
                    {reminderLabel(offset)}
                    <button
                      type="button"
                      aria-label={`Remove reminder ${reminderLabel(offset)}`}
                      onClick={() => void removeReminder(offset)}
                    >
                      <Icon name="x" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <select
              aria-label="Add a reminder"
              value=""
              onChange={(event) => {
                const choice = event.target.value;
                if (choice === "custom") {
                  setOffsetDraft({ amount: "1", unit: "hours" });
                } else if (choice !== "") {
                  void addReminder(choice);
                }
              }}
            >
              <option value="">Add a reminder…</option>
              {REMINDER_PRESETS.map((preset) => (
                <option key={preset.offset} value={preset.offset}>
                  {preset.label}
                </option>
              ))}
              <option value="custom">Custom…</option>
            </select>
            {offsetDraft !== null && (
              <div className="offset-editor">
                <input
                  type="number"
                  min={0}
                  aria-label="Offset amount"
                  value={offsetDraft.amount}
                  onChange={(event) =>
                    setOffsetDraft({ ...offsetDraft, amount: event.target.value })
                  }
                />
                <select
                  aria-label="Offset unit"
                  value={offsetDraft.unit}
                  onChange={(event) =>
                    setOffsetDraft({ ...offsetDraft, unit: event.target.value as OffsetUnit })
                  }
                >
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                </select>
                <span>before</span>
                <button type="button" onClick={() => void addCustomReminder()}>
                  Add reminder
                </button>
                <button type="button" onClick={() => setOffsetDraft(null)}>
                  Cancel
                </button>
              </div>
            )}
          </>
        )}
      </fieldset>
      <RepeatFieldset task={task} onTaskChanged={onTaskChanged} />
      <fieldset className="task-tags">
        <legend>Tags</legend>
        {allTags.length === 0 && <p className="hint">No tags yet — add one in the sidebar.</p>}
        {allTags.map((tag) => (
          <label key={tag.id}>
            <input
              type="checkbox"
              checked={task.tags.some((t) => t.id === tag.id)}
              aria-label={`Tag ${tag.name}`}
              onChange={() => void toggleTag(tag)}
            />
            {tag.name}
          </label>
        ))}
      </fieldset>
      <div className="task-description">
        {descriptionDraft === null ? (
          <>
            <ReactMarkdown>{task.description}</ReactMarkdown>
            <button type="button" onClick={() => setDescriptionDraft(task.description)}>
              Edit description
            </button>
          </>
        ) : (
          <>
            <textarea
              aria-label="Description"
              value={descriptionDraft}
              rows={6}
              onChange={(event) => setDescriptionDraft(event.target.value)}
            />
            <button type="button" onClick={() => void saveDescription()}>
              Save description
            </button>
            <button type="button" onClick={() => setDescriptionDraft(null)}>
              Cancel
            </button>
          </>
        )}
      </div>
      <section className="check-items">
        <ul
          aria-label="Check items"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDropOnList}
        >
          {task.check_items.map((item) =>
            itemEditor?.id === item.id ? (
              <li key={item.id}>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void renameCheckItem();
                  }}
                >
                  <input
                    aria-label="Check item title"
                    value={itemEditor.title}
                    onChange={(event) => setItemEditor({ id: item.id, title: event.target.value })}
                    onBlur={() => void renameCheckItem()}
                  />
                </form>
              </li>
            ) : (
              <li
                key={item.id}
                draggable
                onDragStart={(event) => startDrag(event, { kind: "check-item", id: item.id })}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => handleDropOnCheckItem(event, item)}
              >
                <input
                  type="checkbox"
                  checked={item.done}
                  aria-label={`Tick ${item.title}`}
                  onChange={() => void tickCheckItem(item)}
                />
                <span className={item.done ? "completed" : undefined}>{item.title}</span>
                <span className="row-actions">
                  <button
                    type="button"
                    aria-label={`Edit check item ${item.title}`}
                    onClick={() => setItemEditor({ id: item.id, title: item.title })}
                  >
                    <Icon name="pencil" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete check item ${item.title}`}
                    onClick={() => void removeCheckItem(item)}
                  >
                    <Icon name="x" />
                  </button>
                </span>
              </li>
            ),
          )}
        </ul>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void addCheckItem();
          }}
        >
          <input
            aria-label="Add a check item"
            placeholder="Add a check item…"
            value={newItemTitle}
            onChange={(event) => setNewItemTitle(event.target.value)}
          />
        </form>
      </section>
    </aside>
  );
}
