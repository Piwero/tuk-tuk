import { useState } from "react";

import { createTask, updateTask, type Section, type Task } from "../api";
import { readDragPayload, startDrag } from "../dnd";
import { sortTasks } from "../grouping";
import { appendOrder, byOrder, planInsertBefore } from "../ordering";

interface KanbanViewProps {
  tasks: Task[];
  sections: Section[];
  listId: number;
  onChanged: (update: (current: Task[]) => Task[]) => void;
  onSelect: (taskId: number) => void;
}

interface Column {
  key: string;
  label: string;
  /** A Section id, or null for the ungrouped column. */
  sectionId: number | null;
  tasks: Task[];
}

export function KanbanView({
  tasks,
  sections,
  listId,
  onChanged,
  onSelect,
}: KanbanViewProps): JSX.Element {
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  async function addCard(column: Column): Promise<void> {
    const draft = (drafts[column.key] ?? "").trim();
    if (draft === "") {
      return;
    }
    const created = await createTask(draft, listId, column.sectionId ?? undefined);
    onChanged((current) => [...current, created]);
    setDrafts((current) => ({ ...current, [column.key]: "" }));
  }
  const ungrouped = sortTasks(
    tasks.filter((task) => task.section_id === null),
    "custom",
  );
  const columns: Column[] = [
    // Ungrouped tasks must stay visible, but the board is the Sections.
    ...(ungrouped.length > 0
      ? [{ key: "none", label: "No section", sectionId: null, tasks: ungrouped }]
      : []),
    ...[...sections].sort(byOrder).map((section) => ({
      key: `section-${section.id}`,
      label: section.name,
      sectionId: section.id,
      tasks: sortTasks(
        tasks.filter((task) => task.section_id === section.id),
        "custom",
      ),
    })),
  ];

  function applyTaskUpdate(updated: Task): void {
    onChanged((current) => current.map((t) => (t.id === updated.id ? updated : t)));
  }

  /** Dropping on a column's body appends the card to that Section. */
  async function moveTaskIntoColumn(taskId: number, sectionId: number | null): Promise<void> {
    const siblings = sortTasks(
      tasks.filter((t) => t.section_id === sectionId && t.id !== taskId),
      "custom",
    );
    applyTaskUpdate(
      await updateTask(taskId, { section_id: sectionId, sort_order: appendOrder(siblings) }),
    );
  }

  async function moveTaskBeforeCard(taskId: number, target: Task): Promise<void> {
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
    // Gap exhausted: renumber the column sparsely.
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

  function handleDropOnColumn(event: React.DragEvent, sectionId: number | null): void {
    event.preventDefault();
    const payload = readDragPayload(event);
    if (payload?.kind === "task") {
      void moveTaskIntoColumn(payload.id, sectionId);
    }
  }

  function handleDropOnCard(event: React.DragEvent, target: Task): void {
    event.preventDefault();
    event.stopPropagation();
    const payload = readDragPayload(event);
    if (payload?.kind === "task") {
      void moveTaskBeforeCard(payload.id, target);
    }
  }

  return (
    <section className="kanban" aria-label="Kanban board">
      {columns.map((column) => (
        <div key={column.key} className="kanban-column">
          <h2>{column.label}</h2>
          <ul
            aria-label={`Cards in ${column.label}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => handleDropOnColumn(event, column.sectionId)}
          >
            {column.tasks.map((task) => (
              <li
                key={task.id}
                className="kanban-card"
                draggable
                onDragStart={(event) => startDrag(event, { kind: "task", id: task.id })}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => handleDropOnCard(event, task)}
              >
                <button
                  type="button"
                  className="task-title"
                  aria-label={`Open details for ${task.title}`}
                  onClick={() => onSelect(task.id)}
                >
                  <span className={task.completed ? "completed" : undefined}>{task.title}</span>
                  {task.check_items.length > 0 && (
                    <span className="check-progress">
                      {task.check_items.filter((item) => item.done).length}/
                      {task.check_items.length}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void addCard(column);
            }}
          >
            <input
              aria-label={`Add a task to ${column.label}`}
              placeholder="Add a task…"
              value={drafts[column.key] ?? ""}
              onChange={(event) =>
                setDrafts((current) => ({ ...current, [column.key]: event.target.value }))
              }
            />
          </form>
        </div>
      ))}
    </section>
  );
}
