import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";

import {
  createCheckItem,
  deleteCheckItem,
  updateCheckItem,
  updateTask,
  type CheckItem,
  type Priority,
  type Task,
} from "../api";

const PRIORITY_LABELS: Record<Priority, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
};

import { readDragPayload, startDrag } from "../dnd";
import { planInsertBefore } from "../ordering";

interface TaskDetailProps {
  task: Task;
  onTaskChanged: (task: Task) => void;
  onClose: () => void;
}

export function TaskDetail({ task, onTaskChanged, onClose }: TaskDetailProps): JSX.Element {
  const [title, setTitle] = useState(task.title);
  const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null);
  const [newItemTitle, setNewItemTitle] = useState("");
  const [itemEditor, setItemEditor] = useState<{ id: number; title: string } | null>(null);

  useEffect(() => {
    setTitle(task.title);
    setDescriptionDraft(null);
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
    const payload = readDragPayload(event);
    if (payload?.kind === "check-item") {
      void moveCheckItemBefore(payload.id, target);
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
          ✕
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
        <ul aria-label="Check items">
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
                    ✎
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete check item ${item.title}`}
                    onClick={() => void removeCheckItem(item)}
                  >
                    ✕
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
