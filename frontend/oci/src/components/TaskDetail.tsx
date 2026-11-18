import "./TaskDetail.css";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

import {
  createCheckItem,
  deleteCheckItem,
  fetchFocusSessions,
  fetchGoals,
  fetchSections,
  updateCheckItem,
  updateTask,
  type CheckItem,
  type Goal,
  type Priority,
  type Section,
  type Tag,
  type Task,
  type TaskList,
} from "../api";
import { readDragPayload, startDrag } from "../dnd";
import { PRIORITY_LABELS } from "../grouping";
import { formatFocusTotal } from "../focusTotals";
import { appendOrder, planInsertBefore } from "../ordering";
import { DateRow } from "./DateRow";
import { Hint } from "./Hint";
import { IconButton } from "./IconButton";
import { OverflowMenu } from "./OverflowMenu";
import { PriorityIndicator } from "./PriorityIndicator";
import { PropertyOptions, PropertyRow } from "./PropertyRow";
import { ReminderRow } from "./ReminderRow";
import { RepeatRow } from "./RepeatRow";
import { TagsRow } from "./TagsRow";

const PRIORITIES = Object.keys(PRIORITY_LABELS) as Priority[];

/** A vertical drag past this many pixels on the handle counts as a
 * swipe-to-dismiss (issue #170) — short enough to feel responsive, long
 * enough that a scroll-adjacent touch inside the handle's small hit area
 * doesn't close the sheet by accident. */
const SWIPE_DISMISS_THRESHOLD_PX = 60;

interface TaskDetailProps {
  task: Task;
  allTags: Tag[];
  /** The List this Task belongs to — shown as a breadcrumb above the title
   * (issue #170) so the mobile sheet states where it was opened from,
   * rather than reading as an unfamiliar screen with no context. Null only
   * while `lists` hasn't loaded yet. */
  listName: string | null;
  /** Every List, so the breadcrumb doubles as a picker for moving the Task
   * to another List without leaving the detail view. Empty only while lists
   * haven't loaded — the breadcrumb falls back to plain text then. */
  lists: TaskList[];
  onTaskChanged: (task: Task) => void;
  /** A Tag created from the Tags row, so the app-wide Tag list stays current. */
  onTagCreated: (tag: Tag) => void;
  onClose: () => void;
  /** Opens Focus with this Task linked, clock idle. Absent when Focus is
   * turned off, which hides the button. */
  onStartFocus?: (task: Task) => void;
  /** Deletes the Task (with undo); the caller closes the detail. */
  onDelete: (task: Task) => void;
}

/** The `task_count` Key Results across every Goal — the picker's options.
 * ADR 0012 deliberately gives Goals no capture sigil; this dropdown is the
 * only way to attach a Task. */
function taskCountKeyResults(goals: Goal[]): { goalTitle: string; id: number; name: string }[] {
  return goals.flatMap((goal) =>
    goal.key_results
      .filter((kr) => kr.source === "task_count")
      .map((kr) => ({ goalTitle: goal.title, id: kr.id, name: kr.name })),
  );
}

export function TaskDetail({
  task,
  allTags,
  listName,
  lists,
  onTaskChanged,
  onTagCreated,
  onClose,
  onStartFocus,
  onDelete,
}: TaskDetailProps): JSX.Element {
  const [title, setTitle] = useState(task.title);
  const [goals, setGoals] = useState<Goal[]>([]);

  const [sections, setSections] = useState<Section[]>([]);

  useEffect(() => {
    void fetchGoals().then((page) => setGoals(page.items));
  }, []);

  useEffect(() => {
    let live = true;
    setSections([]);
    void fetchSections(task.list_id).then((page) => {
      if (live) setSections(page.items);
    });
    return () => {
      live = false;
    };
  }, [task.list_id]);
  const [descriptionDraft, setDescriptionDraft] = useState<string | null>(null);
  const [focusedSeconds, setFocusedSeconds] = useState<number | null>(null);

  // Time already focused on this Task: the sum of its linked Focus Sessions.
  const focusEnabled = onStartFocus !== undefined;
  useEffect(() => {
    if (!focusEnabled) {
      return;
    }
    let live = true;
    setFocusedSeconds(null);
    void fetchFocusSessions().then((page) => {
      if (live) {
        setFocusedSeconds(
          page.items
            .filter((session) => session.task_id === task.id)
            .reduce((sum, session) => sum + session.duration_seconds, 0),
        );
      }
    });
    return () => {
      live = false;
    };
  }, [task.id, focusEnabled]);
  const [newItemTitle, setNewItemTitle] = useState("");
  const [itemEditor, setItemEditor] = useState<{ id: number; title: string } | null>(null);
  // Tracks a drag on the mobile sheet's handle (issue #170) — desktop never
  // fires touch events, so this gesture is inert there without any extra
  // gating. Refs, not state: the values only matter to the touchend handler
  // and re-rendering the panel on every touchmove would be wasted work.
  const touchStartY = useRef<number | null>(null);
  const touchLastY = useRef<number | null>(null);

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
    const draft = descriptionDraft;
    setDescriptionDraft(null);
    if (draft !== task.description) {
      onTaskChanged(await updateTask(task.id, { description: draft }));
    }
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

  async function moveToList(listId: number): Promise<void> {
    if (listId === task.list_id) {
      return;
    }
    onTaskChanged(await updateTask(task.id, { list_id: listId }));
  }

  async function moveToSection(sectionId: number | null): Promise<void> {
    if (sectionId === task.section_id) {
      return;
    }
    onTaskChanged(await updateTask(task.id, { section_id: sectionId }));
  }

  async function savePriority(priority: Priority): Promise<void> {
    if (priority !== task.priority) {
      onTaskChanged(await updateTask(task.id, { priority }));
    }
  }

  async function saveKeyResult(keyResultId: number | null): Promise<void> {
    if (keyResultId !== task.key_result_id) {
      onTaskChanged(await updateTask(task.id, { key_result_id: keyResultId }));
    }
  }

  async function toggleCompleted(): Promise<void> {
    onTaskChanged(await updateTask(task.id, { completed: !task.completed }));
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

  const keyResults = taskCountKeyResults(goals);
  const attached = keyResults.find((kr) => kr.id === task.key_result_id);
  const keyResultName = attached === undefined ? null : `${attached.goalTitle}: ${attached.name}`;

  function handleHandleTouchStart(event: React.TouchEvent): void {
    const y = event.touches[0]?.clientY ?? null;
    touchStartY.current = y;
    touchLastY.current = y;
  }

  function handleHandleTouchMove(event: React.TouchEvent): void {
    const y = event.touches[0]?.clientY;
    if (y !== undefined) {
      touchLastY.current = y;
    }
  }

  /** A downward drag past the threshold dismisses, mirroring the backdrop
   * tap and the close button — swipe is a third way out, not the only one
   * (issue #170). */
  function handleHandleTouchEnd(): void {
    if (
      touchStartY.current !== null &&
      touchLastY.current !== null &&
      touchLastY.current - touchStartY.current > SWIPE_DISMISS_THRESHOLD_PX
    ) {
      onClose();
    }
    touchStartY.current = null;
    touchLastY.current = null;
  }

  return (
    <aside className="task-detail" aria-label="Task details">
      {/* Mobile only (hidden by CSS on desktop): the sheet's drag handle —
          both the visible affordance and the swipe-to-dismiss target
          (issue #170). Decorative, so it's kept out of the a11y tree; the
          Close button below is the accessible control. */}
      <div
        className="task-detail-handle"
        aria-hidden="true"
        onTouchStart={handleHandleTouchStart}
        onTouchMove={handleHandleTouchMove}
        onTouchEnd={handleHandleTouchEnd}
      />
      <div className="task-detail-header">
        <nav className="task-detail-breadcrumb property-rows" aria-label="Breadcrumb">
          {lists.length > 0 ? (
            <PropertyRow label="List" value={listName ?? ""}>
              {(close) => (
                <PropertyOptions
                  label="List"
                  options={lists.map((list) => ({ value: list.id, label: list.name }))}
                  selected={task.list_id}
                  onSelect={(listId) => {
                    close();
                    void moveToList(listId);
                  }}
                />
              )}
            </PropertyRow>
          ) : (
            listName !== null && <span className="task-detail-crumb">{listName}</span>
          )}
          {(sections.length > 0 || task.section_id !== null) && (
            <>
              <span className="task-detail-crumb-separator" aria-hidden="true">
                /
              </span>
              <PropertyRow
                label="Section"
                quiet={task.section_id === null}
                value={
                  sections.find((section) => section.id === task.section_id)?.name ?? "No section"
                }
              >
                {(close) => (
                  <PropertyOptions<number | null>
                    label="Section"
                    options={[
                      { value: null, label: "No section" },
                      ...sections.map((section) => ({ value: section.id, label: section.name })),
                    ]}
                    selected={task.section_id}
                    onSelect={(sectionId) => {
                      close();
                      void moveToSection(sectionId);
                    }}
                  />
                )}
              </PropertyRow>
            </>
          )}
        </nav>
        <IconButton icon="x" label="Close details" onClick={onClose} />
      </div>
      <div className="task-detail-title">
        <input
          type="checkbox"
          aria-label="Task complete"
          checked={task.completed}
          onChange={() => void toggleCompleted()}
        />
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
      </div>
      <div className="property-rows">
        <PropertyRow
          label="Priority"
          quiet={task.priority === "none"}
          value={
            <>
              <PriorityIndicator priority={task.priority} />
              {PRIORITY_LABELS[task.priority]}
            </>
          }
        >
          {(close) => (
            <PropertyOptions
              label="Priority"
              options={PRIORITIES.map((level) => ({
                value: level,
                label: PRIORITY_LABELS[level],
              }))}
              selected={task.priority}
              onSelect={(level) => {
                close();
                void savePriority(level);
              }}
            />
          )}
        </PropertyRow>
        <RepeatRow task={task} onTaskChanged={onTaskChanged} />
        <TagsRow
          task={task}
          allTags={allTags}
          onTaskChanged={onTaskChanged}
          onTagCreated={onTagCreated}
        />
        <Hint hintKey="key-result">
          <div className="property-row-hint">
            <PropertyRow
              label="Key Result"
              quiet={task.key_result_id === null}
              value={keyResultName ?? "No Key Result"}
            >
              {(close) => (
                <PropertyOptions<number | null>
                  label="Key Result"
                  options={[
                    { value: null, label: "No Key Result" },
                    ...keyResults.map((kr) => ({
                      value: kr.id,
                      label: `${kr.goalTitle}: ${kr.name}`,
                    })),
                  ]}
                  selected={task.key_result_id}
                  onSelect={(keyResultId) => {
                    close();
                    void saveKeyResult(keyResultId);
                  }}
                />
              )}
            </PropertyRow>
          </div>
        </Hint>
        <DateRow task={task} onTaskChanged={onTaskChanged} />
        <ReminderRow task={task} onTaskChanged={onTaskChanged} />
      </div>
      <div className="task-description">
        {descriptionDraft === null ? (
          // Click (or Enter) to edit in place; the rendered Markdown stays
          // the resting state, so links inside it still work.
          <div
            className="task-description-view"
            role="button"
            tabIndex={0}
            aria-label="Description"
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("a") === null) {
                setDescriptionDraft(task.description);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && event.target === event.currentTarget) {
                event.preventDefault();
                setDescriptionDraft(task.description);
              }
            }}
          >
            {task.description.trim() === "" ? (
              <p className="task-description-placeholder">Add a description…</p>
            ) : (
              <ReactMarkdown>{task.description}</ReactMarkdown>
            )}
          </div>
        ) : (
          <textarea
            aria-label="Description"
            value={descriptionDraft}
            rows={6}
            autoFocus
            onChange={(event) => setDescriptionDraft(event.target.value)}
            onBlur={() => void saveDescription()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                // Discard, and keep Escape from closing the detail too.
                event.preventDefault();
                event.stopPropagation();
                event.nativeEvent.stopImmediatePropagation();
                setDescriptionDraft(null);
              }
            }}
          />
        )}
      </div>
      <section className="check-items" aria-label="Check items section">
        {task.check_items.length > 0 && (
          <div className="check-items-progress">
            <span>
              {task.check_items.filter((item) => item.done).length} of {task.check_items.length}
            </span>
            <progress
              aria-label="Check items progress"
              value={task.check_items.filter((item) => item.done).length}
              max={task.check_items.length}
              aria-valuenow={task.check_items.filter((item) => item.done).length}
              aria-valuemax={task.check_items.length}
            />
          </div>
        )}
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
                  <IconButton
                    icon="pencil"
                    label={`Edit check item ${item.title}`}
                    onClick={() => setItemEditor({ id: item.id, title: item.title })}
                  />
                  <IconButton
                    icon="x"
                    label={`Delete check item ${item.title}`}
                    onClick={() => void removeCheckItem(item)}
                  />
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
      <div className="task-detail-footer">
        {onStartFocus !== undefined && (
          <button type="button" className="btn-focus" onClick={() => onStartFocus(task)}>
            Start focus
            {focusedSeconds !== null && focusedSeconds > 0 && (
              <span className="task-detail-focused">
                {" · "}
                {formatFocusTotal(focusedSeconds)} focused
              </span>
            )}
          </button>
        )}
        <OverflowMenu
          label="More task actions"
          items={[
            {
              text: "Delete task",
              icon: "trash-2",
              danger: true,
              onSelect: () => onDelete(task),
            },
          ]}
        />
      </div>
    </aside>
  );
}
