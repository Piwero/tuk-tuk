import { useState } from "react";

import {
  createSection,
  deleteSection,
  deleteTask,
  updateSection,
  updateTask,
  type Section,
  type Task,
} from "../api";
import { readDragPayload, startDrag } from "../dnd";
import { groupTasks, sortTasks, type GroupBy, type SortBy, type TaskGroup } from "../grouping";
import { appendOrder, byOrder, planInsertBefore } from "../ordering";

interface TaskListViewProps {
  tasks: Task[];
  /** Sections of the viewed List; empty in tag views. */
  sections: Section[];
  /** The viewed List, or null when the view is not a List (no section affordances). */
  listId: number | null;
  groupBy: GroupBy;
  sortBy: SortBy;
  onChanged: (update: (current: Task[]) => Task[]) => void;
  onSelect: (taskId: number) => void;
  onSectionsChanged: (update: (current: Section[]) => Section[]) => void;
}

export function TaskListView({
  tasks,
  sections,
  listId,
  groupBy,
  sortBy,
  onChanged,
  onSelect,
  onSectionsChanged,
}: TaskListViewProps): JSX.Element {
  const [addingSection, setAddingSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [sectionEditor, setSectionEditor] = useState<{ id: number; name: string } | null>(null);

  async function toggle(task: Task): Promise<void> {
    const updated = await updateTask(task.id, { completed: !task.completed });
    onChanged((current) => current.map((t) => (t.id === updated.id ? updated : t)));
  }

  async function remove(task: Task): Promise<void> {
    await deleteTask(task.id);
    onChanged((current) => current.filter((t) => t.id !== task.id));
  }

  async function addSection(): Promise<void> {
    const trimmed = newSectionName.trim();
    if (trimmed === "" || listId === null) {
      return;
    }
    const created = await createSection(listId, trimmed);
    onSectionsChanged((current) => [...current, created]);
    setNewSectionName("");
    setAddingSection(false);
  }

  async function renameSection(): Promise<void> {
    if (sectionEditor === null) {
      return;
    }
    const trimmed = sectionEditor.name.trim();
    if (trimmed !== "") {
      const updated = await updateSection(sectionEditor.id, { name: trimmed });
      onSectionsChanged((current) =>
        current.map((section) => (section.id === updated.id ? updated : section)),
      );
    }
    setSectionEditor(null);
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

  function applyTaskUpdate(updated: Task): void {
    onChanged((current) => current.map((t) => (t.id === updated.id ? updated : t)));
  }

  async function moveTaskBefore(taskId: number, target: Task): Promise<void> {
    const moved = tasks.find((t) => t.id === taskId);
    if (moved === undefined || taskId === target.id) {
      return;
    }
    const siblings = sortTasks(
      tasks.filter((t) => t.section_id === target.section_id && t.id !== taskId),
      "custom",
    );
    const plan = planInsertBefore(siblings, moved, target.id);
    if (plan.kind === "single") {
      applyTaskUpdate(
        await updateTask(taskId, { section_id: target.section_id, sort_order: plan.sort_order }),
      );
      return;
    }
    // Gap exhausted: renumber the group sparsely.
    const updates = await Promise.all(
      plan.rows.map(({ row, sort_order }) =>
        updateTask(row.id, {
          sort_order,
          ...(row.id === taskId ? { section_id: target.section_id } : {}),
        }),
      ),
    );
    onChanged((current) => current.map((t) => updates.find((updated) => updated.id === t.id) ?? t));
  }

  function handleDropOnTaskRow(event: React.DragEvent, target: Task): void {
    if (!canDragReorder) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const payload = readDragPayload(event);
    if (payload?.kind === "task") {
      void moveTaskBefore(payload.id, target);
    }
  }

  /** Dropping on a group header appends the task to that Section (null = ungroup). */
  async function moveTaskIntoSection(taskId: number, sectionId: number | null): Promise<void> {
    const siblings = sortTasks(
      tasks.filter((t) => t.section_id === sectionId && t.id !== taskId),
      "custom",
    );
    applyTaskUpdate(
      await updateTask(taskId, { section_id: sectionId, sort_order: appendOrder(siblings) }),
    );
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
      void moveTaskIntoSection(payload.id, sectionId);
    }
    if (payload?.kind === "section" && sectionId !== null && payload.id !== sectionId) {
      const target = sections.find((s) => s.id === sectionId);
      if (target !== undefined) {
        void moveSectionBefore(payload.id, target);
      }
    }
  }

  function renderTaskRow(task: Task): JSX.Element {
    return (
      <li
        key={task.id}
        data-priority={task.priority}
        draggable
        onDragStart={(event) => startDrag(event, { kind: "task", id: task.id })}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => handleDropOnTaskRow(event, task)}
      >
        <label>
          <input
            type="checkbox"
            checked={task.completed}
            aria-label={`Complete ${task.title}`}
            onChange={() => void toggle(task)}
          />
        </label>
        <button
          type="button"
          className="task-title"
          aria-label={`Open details for ${task.title}`}
          onClick={() => onSelect(task.id)}
        >
          <span className={task.completed ? "completed" : undefined}>{task.title}</span>
          {task.tags.map((tag) => (
            <span
              key={tag.id}
              className="tag-chip"
              style={tag.color === null ? undefined : { borderColor: tag.color }}
            >
              {tag.name}
            </span>
          ))}
          {task.check_items.length > 0 && (
            <span className="check-progress">
              {task.check_items.filter((item) => item.done).length}/{task.check_items.length}
            </span>
          )}
        </button>
        <button type="button" aria-label={`Delete ${task.title}`} onClick={() => void remove(task)}>
          Delete
        </button>
      </li>
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
          (section !== null && sectionEditor?.id === section.id ? (
            <form
              className="list-form"
              onSubmit={(event) => {
                event.preventDefault();
                void renameSection();
              }}
            >
              <label>
                Section name
                <input
                  value={sectionEditor.name}
                  onChange={(event) =>
                    setSectionEditor({ id: section.id, name: event.target.value })
                  }
                />
              </label>
              <button type="submit">Save</button>
              <button type="button" onClick={() => setSectionEditor(null)}>
                Cancel
              </button>
            </form>
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
                  <button
                    type="button"
                    aria-label={`Rename section ${section.name}`}
                    onClick={() => setSectionEditor({ id: section.id, name: section.name })}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete section ${section.name}`}
                    onClick={() => void removeSection(section)}
                  >
                    ✕
                  </button>
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

  const groups = groupTasks(tasks, listId === null ? [] : sections, groupBy, sortBy);

  return (
    <div className="task-groups">
      {groups.map((group) => renderGroup(group))}
      {listId !== null &&
        groupBy === "section" &&
        (addingSection ? (
          <form
            className="list-form"
            onSubmit={(event) => {
              event.preventDefault();
              void addSection();
            }}
          >
            <label>
              Section name
              <input
                value={newSectionName}
                onChange={(event) => setNewSectionName(event.target.value)}
              />
            </label>
            <button type="submit">Save</button>
            <button type="button" onClick={() => setAddingSection(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" className="add-section" onClick={() => setAddingSection(true)}>
            Add Section
          </button>
        ))}
    </div>
  );
}
