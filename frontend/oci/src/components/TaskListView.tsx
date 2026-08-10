import { useState } from "react";

import {
  createSection,
  deleteSection,
  deleteTask,
  updateSection,
  updateTask,
  type Section,
  type Task,
  type TaskList,
} from "../api";
import { formatSchedule, isOverdue } from "../dates";
import { endDrag, readDragPayload, startDrag } from "../dnd";
import { groupTasks, type GroupBy, type SortBy, type TaskGroup } from "../grouping";
import { appendOrder, byOrder, planInsertBefore } from "../ordering";
import { applierFor, moveTaskBeforeTask, moveTaskToSectionEnd } from "../taskMoves";
import { SectionNameForm } from "./SectionNameForm";
import { Icon } from "./Icon";

interface TaskListViewProps {
  tasks: Task[];
  /** Sections of the viewed List; empty in tag views. */
  sections: Section[];
  /** The viewed List, or null when the view is not a List (no section affordances). */
  listId: number | null;
  /** All Lists, used to label each task's List when the view spans multiple Lists. */
  lists: TaskList[];
  groupBy: GroupBy;
  sortBy: SortBy;
  onChanged: (update: (current: Task[]) => Task[]) => void;
  onSelect: (taskId: number) => void;
  onSectionsChanged: (update: (current: Section[]) => Section[]) => void;
  /** The task row's "Start Focus" shortcut, when the app offers Focus here. */
  onStartFocus?: (task: Task) => void;
}

export function TaskListView({
  tasks,
  sections,
  listId,
  lists,
  groupBy,
  sortBy,
  onChanged,
  onSelect,
  onSectionsChanged,
  onStartFocus,
}: TaskListViewProps): JSX.Element {
  const [addingSection, setAddingSection] = useState(false);
  const [renamingSectionId, setRenamingSectionId] = useState<number | null>(null);

  async function toggle(task: Task): Promise<void> {
    const updated = await updateTask(task.id, { completed: !task.completed });
    onChanged((current) => current.map((t) => (t.id === updated.id ? updated : t)));
  }

  async function remove(task: Task): Promise<void> {
    await deleteTask(task.id);
    onChanged((current) => current.filter((t) => t.id !== task.id));
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
    return (
      <li
        key={task.id}
        data-priority={task.priority}
        data-overdue={isOverdue(task) || undefined}
        draggable
        onDragStart={(event) => startDrag(event, { kind: "task", id: task.id })}
        onDragEnd={endDrag}
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
          {listId === null &&
            (() => {
              const taskList = lists.find((list) => list.id === task.list_id);
              return taskList !== undefined ? (
                <span
                  className="list-chip"
                  style={taskList.color === null ? undefined : { borderColor: taskList.color }}
                >
                  {taskList.emoji !== null ? `${taskList.emoji} ` : ""}
                  {taskList.name}
                </span>
              ) : null;
            })()}
          {task.due_date !== null && (
            <span className={isOverdue(task) ? "date-chip overdue" : "date-chip"}>
              {formatSchedule(task)}
            </span>
          )}
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
        {onStartFocus !== undefined && (
          <button
            type="button"
            aria-label={`Start Focus for ${task.title}`}
            onClick={() => onStartFocus(task)}
          >
            Focus
          </button>
        )}
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
                  <button
                    type="button"
                    aria-label={`Rename section ${section.name}`}
                    onClick={() => setRenamingSectionId(section.id)}
                  >
                    <Icon name="pencil" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete section ${section.name}`}
                    onClick={() => void removeSection(section)}
                  >
                    <Icon name="x" />
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
    </div>
  );
}
