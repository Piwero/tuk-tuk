import { useEffect, useState } from "react";

import {
  createSection,
  deleteSection,
  deleteTask,
  updateSection,
  updateTask,
  type Section,
  type Tag,
  type Task,
  type TaskList,
  type TaskPatch,
} from "../api";
import { allDaySchedule } from "../dates";
import { endDrag, readDragPayload, startDrag } from "../dnd";
import { groupTasks, type GroupBy, type SortBy, type TaskGroup } from "../grouping";
import { appendOrder, byOrder, planInsertBefore } from "../ordering";
import { applierFor, moveTaskBeforeTask, moveTaskToSectionEnd } from "../taskMoves";
import { useTaskCompletion } from "../taskCompletion";
import { useTaskSelection } from "../taskSelection";
import { type UndoQueue } from "../undoQueue";
import { BulkActionBar } from "./BulkActionBar";
import { Modal } from "./Modal";
import { PomoQuickStartMenu } from "./PomoQuickStartMenu";
import { SectionNameForm } from "./SectionNameForm";
import { IconButton } from "./IconButton";
import { TaskRow } from "./TaskRow";

interface TaskListViewProps {
  tasks: Task[];
  /** Sections of the viewed List; empty in tag views. */
  sections: Section[];
  /** The viewed List, or null when the view is not a List (no section affordances). */
  listId: number | null;
  /** All Lists, used to label each task's List when the view spans multiple
   * Lists, and to populate the bulk "Move to list" picker (issue #202). */
  lists: TaskList[];
  /** Every Tag, for the bulk "Add tag" picker (issue #202). */
  tags: Tag[];
  /** A stable key for the view on screen — the selection (issue #202) clears
   * whenever it changes, so a marked row never carries across a view switch. */
  viewKey: string;
  groupBy: GroupBy;
  sortBy: SortBy;
  onChanged: (update: (current: Task[]) => Task[]) => void;
  onSelect: (taskId: number) => void;
  onSectionsChanged: (update: (current: Section[]) => Section[]) => void;
  /** The task row's "Start Focus" shortcut, when the app offers Focus here. */
  onStartFocus?: (task: Task) => void;
  /** Opens the command palette scoped to one Task (issue #205). */
  onOpenActions?: (task: Task) => void;
  /** The app-wide toast queue (see App.tsx). This view raises toasts but no
   * longer renders them: the single <ToastStack> lives at the app root so a
   * toast survives — and covers — any screen (#191). */
  toasts: UndoQueue;
}

export function TaskListView({
  tasks,
  sections,
  listId,
  lists,
  tags,
  viewKey,
  groupBy,
  sortBy,
  onChanged,
  onSelect,
  onSectionsChanged,
  onStartFocus,
  onOpenActions,
  toasts,
}: TaskListViewProps): JSX.Element {
  const [addingSection, setAddingSection] = useState(false);
  const [renamingSectionId, setRenamingSectionId] = useState<number | null>(null);
  const selection = useTaskSelection();
  const clearSelection = selection.clear;
  // A pending bulk completion greys its rows the same way a single pending
  // completion does — without touching `task.completed` (a recurring Task
  // never flips it), so an Undo simply un-greys them.
  const [bulkPending, setBulkPending] = useState<Set<number>>(() => new Set());
  const [bulkDialog, setBulkDialog] = useState<"reschedule" | "move" | "tag" | null>(null);

  // The selection is per-view: switching Lists (or to a Smart List) drops it.
  useEffect(() => {
    clearSelection();
    setBulkPending(new Set());
  }, [viewKey, clearSelection]);
  const [quickStart, setQuickStart] = useState<{
    task: Task;
    position: { x: number; y: number };
  } | null>(null);

  // Delete and complete are both undoable (#155): the toast holds the action
  // for a few seconds before anything reaches the backend, so undo is just
  // "never send the request" rather than a separate restore call. A recurring
  // Task's completion branches server-side per ADR 0003 (advance in place +
  // write a Completed Occurrence) — deferring the PATCH means there is
  // nothing to unwind locally when the user undoes it, since it never
  // happened. Complete and delete share the app-wide queue (and its single
  // ToastStack) rather than each keeping their own.
  const completion = useTaskCompletion(onChanged, toasts);

  function remove(task: Task): void {
    onChanged((current) => current.filter((t) => t.id !== task.id));
    toasts.push(
      "Task deleted",
      () => deleteTask(task.id),
      () => onChanged((current) => [...current, task]),
    );
  }

  const selectedTasks = (): Task[] => tasks.filter((task) => selection.isSelected(task.id));

  const taskWord = (n: number): string => (n === 1 ? "Task" : "Tasks");

  /** Run `op` against every target one Task at a time (no bulk route),
   * tolerating partial failure: the fulfilled Tasks come back in `updated`,
   * the rejected ones in `failed` so the caller can name them. */
  async function runPerTask(
    targets: Task[],
    op: (task: Task) => Promise<Task>,
  ): Promise<{ updated: Task[]; failed: Task[] }> {
    const results = await Promise.allSettled(targets.map((task) => op(task)));
    const updated: Task[] = [];
    const failed: Task[] = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        updated.push(result.value);
      } else {
        failed.push(targets[index]!);
      }
    });
    return { updated, failed };
  }

  const applyUpdated = (updated: Task[]): void =>
    onChanged((current) => current.map((task) => updated.find((u) => u.id === task.id) ?? task));

  const reportFailures = (verb: string, failed: Task[]): void => {
    if (failed.length > 0) {
      toasts.notify(`Couldn't ${verb}: ${failed.map((task) => task.title).join(", ")}`);
    }
  };

  function bulkComplete(): void {
    const targets = selectedTasks().filter((task) => !task.completed && !bulkPending.has(task.id));
    if (targets.length === 0) {
      return;
    }
    const ids = new Set(targets.map((task) => task.id));
    setBulkPending((current) => new Set([...current, ...ids]));
    selection.clear();
    const unmark = (): void =>
      setBulkPending((current) => new Set([...current].filter((id) => !ids.has(id))));
    toasts.push(
      `Completed ${targets.length} ${taskWord(targets.length)}`,
      async () => {
        const { updated, failed } = await runPerTask(targets, (task) =>
          updateTask(task.id, { completed: true }),
        );
        applyUpdated(updated);
        unmark();
        reportFailures("complete", failed);
      },
      unmark,
    );
  }

  function bulkDelete(): void {
    const targets = selectedTasks();
    if (targets.length === 0) {
      return;
    }
    const ids = new Set(targets.map((task) => task.id));
    onChanged((current) => current.filter((task) => !ids.has(task.id)));
    selection.clear();
    toasts.push(
      `Deleted ${targets.length} ${taskWord(targets.length)}`,
      async () => {
        const { failed } = await runPerTask(targets, (task) =>
          deleteTask(task.id).then(() => task),
        );
        if (failed.length > 0) {
          onChanged((current) => [...current, ...failed]);
          reportFailures("delete", failed);
        }
      },
      () => onChanged((current) => [...current, ...targets]),
    );
  }

  /** Shared shape for reschedule / move / add-tag: an optimistic local edit,
   * one deferred PATCH per Task, undo restores the pre-images. */
  function bulkPatch(
    verb: string,
    label: string,
    patchFor: (task: Task) => TaskPatch,
    localEdit: (task: Task) => Task,
  ): void {
    const targets = selectedTasks();
    if (targets.length === 0) {
      return;
    }
    const preImages = targets.map((task) => ({ ...task }));
    const ids = new Set(targets.map((task) => task.id));
    onChanged((current) => current.map((task) => (ids.has(task.id) ? localEdit(task) : task)));
    selection.clear();
    setBulkDialog(null);
    toasts.push(
      label,
      async () => {
        const { updated, failed } = await runPerTask(targets, (task) =>
          updateTask(task.id, patchFor(task)),
        );
        applyUpdated(updated);
        if (failed.length > 0) {
          const failedIds = new Set(failed.map((task) => task.id));
          onChanged((current) =>
            current.map(
              (task) => preImages.find((p) => p.id === task.id && failedIds.has(p.id)) ?? task,
            ),
          );
          reportFailures(verb, failed);
        }
      },
      () =>
        onChanged((current) =>
          current.map((task) => preImages.find((p) => p.id === task.id) ?? task),
        ),
    );
  }

  function bulkReschedule(day: string): void {
    const patch = allDaySchedule(null, day);
    bulkPatch(
      "reschedule",
      `Rescheduled ${selection.size} ${taskWord(selection.size)}`,
      () => patch,
      (task) => ({
        ...task,
        ...patch,
      }),
    );
  }

  function bulkMove(targetListId: number): void {
    bulkPatch(
      "move",
      `Moved ${selection.size} ${taskWord(selection.size)}`,
      () => ({ list_id: targetListId }),
      (task) => ({ ...task, list_id: targetListId }),
    );
  }

  function bulkAddTag(tagId: number): void {
    const tag = tags.find((t) => t.id === tagId);
    bulkPatch(
      "add tag",
      `Tagged ${selection.size} ${taskWord(selection.size)}`,
      (task) => ({ tag_ids: [...new Set([...task.tags.map((t) => t.id), tagId])] }),
      (task) =>
        task.tags.some((t) => t.id === tagId) || tag === undefined
          ? task
          : { ...task, tags: [...task.tags, tag] },
    );
  }

  async function addSection(name: string): Promise<void> {
    if (listId === null) {
      return;
    }
    const created = await createSection(listId, name);
    onSectionsChanged((current) => [...current, created]);
    setAddingSection(false);
  }

  async function renameSection(sectionId: number, name: string): Promise<void> {
    const updated = await updateSection(sectionId, { name });
    onSectionsChanged((current) =>
      current.map((section) => (section.id === updated.id ? updated : section)),
    );
    setRenamingSectionId(null);
  }

  async function removeSection(section: Section): Promise<void> {
    const confirmed = window.confirm(
      `Delete the section "${section.name}"? Its tasks stay in the list, ungrouped.`,
    );
    if (!confirmed) {
      return;
    }
    await deleteSection(section.id);
    onSectionsChanged((current) => current.filter((s) => s.id !== section.id));
    onChanged((current) =>
      current.map((task) =>
        task.section_id === section.id ? { ...task, section_id: null } : task,
      ),
    );
  }

  // Manual drag-reorder only makes sense in the manually ordered, section-
  // grouped List view; other groupings/sorts are computed projections.
  const canDragReorder = listId !== null && groupBy === "section" && sortBy === "custom";

  const apply = applierFor(onChanged);

  function handleDropOnTaskRow(event: React.DragEvent, target: Task): void {
    if (!canDragReorder) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const payload = readDragPayload(event);
    if (payload?.kind === "task") {
      void moveTaskBeforeTask(tasks, payload.id, target, apply);
    }
  }

  async function moveSectionBefore(sectionId: number, target: Section): Promise<void> {
    const moved = sections.find((s) => s.id === sectionId);
    if (moved === undefined || sectionId === target.id) {
      return;
    }
    const siblings = [...sections].sort(byOrder).filter((s) => s.id !== sectionId);
    const plan = planInsertBefore(siblings, moved, target.id);
    const updates =
      plan.kind === "single"
        ? [await updateSection(sectionId, { sort_order: plan.sort_order })]
        : await Promise.all(
            plan.rows.map(({ row, sort_order }) => updateSection(row.id, { sort_order })),
          );
    onSectionsChanged((current) =>
      current.map((s) => updates.find((updated) => updated.id === s.id) ?? s),
    );
  }

  function handleDropOnGroupHeader(event: React.DragEvent, sectionId: number | null): void {
    if (!canDragReorder) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const payload = readDragPayload(event);
    if (payload?.kind === "task") {
      void moveTaskToSectionEnd(tasks, payload.id, sectionId, apply);
    }
    if (payload?.kind === "section" && sectionId !== null && payload.id !== sectionId) {
      const target = sections.find((s) => s.id === sectionId);
      if (target !== undefined) {
        void moveSectionBefore(payload.id, target);
      }
    }
  }

  function renderTaskRow(task: Task): JSX.Element {
    function handleKebabClick(event: React.MouseEvent<HTMLButtonElement>): void {
      const rect = event.currentTarget.getBoundingClientRect();
      setQuickStart({ task, position: { x: rect.left, y: rect.bottom } });
    }

    // A single List's own view already says which List you're in — the
    // badge only earns its place in views that span multiple Lists.
    const taskList = listId === null ? lists.find((list) => list.id === task.list_id) : undefined;

    return (
      <TaskRow
        key={task.id}
        task={task}
        completed={task.completed || completion.isPending(task.id) || bulkPending.has(task.id)}
        list={taskList}
        showDate
        showTags
        showCheckProgress
        selectable
        selected={selection.isSelected(task.id)}
        onSelectToggle={(shiftKey) =>
          shiftKey ? selection.extendTo(task.id, orderedIds) : selection.toggle(task.id)
        }
        onSelectionClear={selection.clear}
        onToggle={completion.toggle}
        onSelect={onSelect}
        onStartFocus={onStartFocus}
        onKebabClick={onStartFocus === undefined ? undefined : handleKebabClick}
        onDelete={(t) => void remove(t)}
        onOpenActions={onOpenActions}
        draggable
        onDragStart={(event) => startDrag(event, { kind: "task", id: task.id })}
        onDragEnd={endDrag}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => handleDropOnTaskRow(event, task)}
        onContextMenu={(event) => {
          event.preventDefault();
          setQuickStart({ task, position: { x: event.clientX, y: event.clientY } });
        }}
      />
    );
  }

  function renderGroup(group: TaskGroup): JSX.Element {
    const section =
      typeof group.sectionId === "number"
        ? (sections.find((s) => s.id === group.sectionId) ?? null)
        : null;
    return (
      <section key={group.key} className="task-group">
        {group.label !== null &&
          (section !== null && renamingSectionId === section.id ? (
            <SectionNameForm
              initialName={section.name}
              onSubmit={(name) => void renameSection(section.id, name)}
              onCancel={() => setRenamingSectionId(null)}
            />
          ) : (
            <div
              className="group-header"
              draggable={section !== null}
              onDragStart={(event) => {
                if (section !== null) {
                  startDrag(event, { kind: "section", id: section.id });
                }
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                if (group.sectionId !== undefined) {
                  handleDropOnGroupHeader(event, group.sectionId);
                }
              }}
            >
              <h2>{group.label}</h2>
              {section !== null && (
                <span className="row-actions">
                  <IconButton
                    icon="pencil"
                    label={`Rename section ${section.name}`}
                    onClick={() => setRenamingSectionId(section.id)}
                  />
                  <IconButton
                    icon="x"
                    label={`Delete section ${section.name}`}
                    onClick={() => void removeSection(section)}
                  />
                </span>
              )}
            </div>
          ))}
        <ul
          className="tasks"
          aria-label={group.label === null ? "Tasks" : `Tasks in ${group.label}`}
        >
          {group.tasks.map((task) => renderTaskRow(task))}
        </ul>
      </section>
    );
  }

  const groups = groupTasks(tasks, listId === null ? [] : sections, groupBy, sortBy, lists);
  // Task ids in the order they appear on screen — what Shift-extend walks.
  const orderedIds = groups.flatMap((group) => group.tasks.map((task) => task.id));

  async function moveSectionToEnd(sectionId: number): Promise<void> {
    const siblings = [...sections].sort(byOrder).filter((s) => s.id !== sectionId);
    if (siblings.length === sections.length) {
      return;
    }
    const updated = await updateSection(sectionId, { sort_order: appendOrder(siblings) });
    onSectionsChanged((current) => current.map((s) => (s.id === updated.id ? updated : s)));
  }

  /** Dropping on empty container space moves the payload to the end. */
  function handleDropOnContainer(event: React.DragEvent): void {
    if (!canDragReorder) {
      return;
    }
    event.preventDefault();
    const payload = readDragPayload(event);
    if (payload?.kind === "task") {
      // The space below the groups belongs to no Section.
      void moveTaskToSectionEnd(tasks, payload.id, null, apply);
    }
    if (payload?.kind === "section") {
      void moveSectionToEnd(payload.id);
    }
  }

  return (
    <>
      {selection.size > 0 && (
        <BulkActionBar
          count={selection.size}
          onComplete={bulkComplete}
          onReschedule={() => setBulkDialog("reschedule")}
          onMove={() => setBulkDialog("move")}
          onAddTag={() => setBulkDialog("tag")}
          onDelete={bulkDelete}
          onClear={selection.clear}
        />
      )}
      {bulkDialog === "reschedule" && (
        <Modal title="Reschedule selected Tasks" onClose={() => setBulkDialog(null)}>
          <form
            className="bulk-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              const day = new FormData(event.currentTarget).get("day")?.toString() ?? "";
              if (day !== "") {
                bulkReschedule(day);
              }
            }}
          >
            <label>
              Due date
              <input type="date" name="day" aria-label="Due date" required />
            </label>
            <button type="submit">Reschedule</button>
          </form>
        </Modal>
      )}
      {bulkDialog === "move" && (
        <Modal title="Move selected Tasks" onClose={() => setBulkDialog(null)}>
          <form
            className="bulk-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              const value = new FormData(event.currentTarget).get("list")?.toString() ?? "";
              if (value !== "") {
                bulkMove(Number(value));
              }
            }}
          >
            <label>
              List
              <select name="list" aria-label="List" defaultValue="">
                <option value="" disabled>
                  Choose a List…
                </option>
                {lists
                  .filter((list) => !list.is_archived)
                  .map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name}
                    </option>
                  ))}
              </select>
            </label>
            <button type="submit">Move</button>
          </form>
        </Modal>
      )}
      {bulkDialog === "tag" && (
        <Modal title="Add a Tag to selected Tasks" onClose={() => setBulkDialog(null)}>
          <form
            className="bulk-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              const value = new FormData(event.currentTarget).get("tag")?.toString() ?? "";
              if (value !== "") {
                bulkAddTag(Number(value));
              }
            }}
          >
            <label>
              Tag
              <select name="tag" aria-label="Tag" defaultValue="">
                <option value="" disabled>
                  Choose a Tag…
                </option>
                {tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">Add Tag</button>
          </form>
        </Modal>
      )}
      <div
        className="task-groups"
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDropOnContainer}
      >
        {groups.map((group) => renderGroup(group))}
        {listId !== null &&
          groupBy === "section" &&
          (addingSection ? (
            <SectionNameForm
              onSubmit={(name) => void addSection(name)}
              onCancel={() => setAddingSection(false)}
            />
          ) : (
            <button type="button" className="add-section" onClick={() => setAddingSection(true)}>
              Add Section
            </button>
          ))}
        {quickStart !== null && (
          <PomoQuickStartMenu
            task={quickStart.task}
            position={quickStart.position}
            onClose={() => setQuickStart(null)}
          />
        )}
      </div>
    </>
  );
}
