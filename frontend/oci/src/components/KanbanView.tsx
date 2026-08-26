import { useState } from "react";

import { createSection, createTask, type Section, type Task } from "../api";
import { endDrag, readDragPayload, startDrag } from "../dnd";
import { groupTasks } from "../grouping";
import { applierFor, moveTaskBeforeTask, moveTaskToSectionEnd } from "../taskMoves";
import { useTaskCompletion } from "../taskCompletion";
import { type UndoQueue } from "../undoQueue";
import { SectionNameForm } from "./SectionNameForm";
import { TaskRow } from "./TaskRow";

interface KanbanViewProps {
  tasks: Task[];
  sections: Section[];
  listId: number;
  onChanged: (update: (current: Task[]) => Task[]) => void;
  onSelect: (taskId: number) => void;
  onSectionsChanged: (update: (current: Section[]) => Section[]) => void;
  /** The app-wide toast queue — see TaskListView for why the board doesn't
   * own one. */
  toasts: UndoQueue;
  /** Confirms a card the board just created, so the Kanban add reports back
   * exactly like the two quick adds do (#191). */
  onCreated: (task: Task) => void;
}

export function KanbanView({
  tasks,
  sections,
  listId,
  onChanged,
  onSelect,
  onSectionsChanged,
  toasts,
  onCreated,
}: KanbanViewProps): JSX.Element {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [addingSection, setAddingSection] = useState(false);

  // Completing a card goes through the exact same undoable flow as the List
  // view's checkbox (#155, ADR 0003) — see ../taskCompletion for why this is
  // a shared hook rather than a second implementation.
  const undoQueue = toasts;
  const completion = useTaskCompletion(onChanged, undoQueue);

  const apply = applierFor(onChanged);

  // The board is the Sections; the ungrouped column appears only while
  // sectionless tasks exist, so nothing is ever hidden.
  const columns = groupTasks(tasks, sections, "section", "custom")
    .map((group) => ({
      key: group.key,
      label: group.label ?? "No section",
      sectionId: group.sectionId ?? null,
      tasks: group.tasks,
    }))
    .filter((column) => column.sectionId !== null || column.tasks.length > 0);

  async function addCard(columnKey: string, sectionId: number | null): Promise<void> {
    const draft = (drafts[columnKey] ?? "").trim();
    if (draft === "") {
      return;
    }
    const created = await createTask({
      title: draft,
      list_id: listId,
      ...(sectionId === null ? {} : { section_id: sectionId }),
    });
    onChanged((current) => [...current, created]);
    onCreated(created);
    setDrafts((current) => ({ ...current, [columnKey]: "" }));
  }

  async function addSection(name: string): Promise<void> {
    const created = await createSection(listId, name);
    onSectionsChanged((current) => [...current, created]);
    setAddingSection(false);
  }

  function handleDropOnColumn(event: React.DragEvent, sectionId: number | null): void {
    event.preventDefault();
    const payload = readDragPayload(event);
    if (payload?.kind === "task") {
      void moveTaskToSectionEnd(tasks, payload.id, sectionId, apply);
    }
  }

  function handleDropOnCard(event: React.DragEvent, target: Task): void {
    event.preventDefault();
    event.stopPropagation();
    const payload = readDragPayload(event);
    if (payload?.kind === "task") {
      void moveTaskBeforeTask(tasks, payload.id, target, apply);
    }
  }

  return (
    <>
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
                <TaskRow
                  key={task.id}
                  task={task}
                  completed={task.completed || completion.isPending(task.id)}
                  className="kanban-card"
                  showDate
                  showTags
                  showCheckProgress
                  onToggle={completion.toggle}
                  onSelect={onSelect}
                  draggable
                  onDragStart={(event) => startDrag(event, { kind: "task", id: task.id })}
                  onDragEnd={endDrag}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => handleDropOnCard(event, task)}
                />
              ))}
            </ul>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void addCard(column.key, column.sectionId);
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
        <div className="kanban-column kanban-add-column">
          {addingSection ? (
            <SectionNameForm
              onSubmit={(name) => void addSection(name)}
              onCancel={() => setAddingSection(false)}
            />
          ) : (
            <button type="button" className="add-section" onClick={() => setAddingSection(true)}>
              Add Section
            </button>
          )}
        </div>
      </section>
    </>
  );
}
