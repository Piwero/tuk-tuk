import { deleteTask, updateTask, type CompletedOccurrence, type Task } from "../api";
import { localDayOf } from "../dates";
import { Icon } from "./Icon";

interface CompletedViewProps {
  tasks: Task[];
  occurrences: CompletedOccurrence[];
  onChanged: (update: (current: Task[]) => Task[]) => void;
  onSelect: (taskId: number) => void;
}

/** One row of completion history: a completed task row keeps its affordances;
 * a Completed Occurrence row is a plain record — the task itself is still
 * open, so there is nothing to reopen or delete here. */
type HistoryRow =
  | { kind: "task"; completedAt: string; task: Task }
  | { kind: "occurrence"; completedAt: string; occurrence: CompletedOccurrence };

/** The completed view: completed tasks and the Completed Occurrences of
 * recurring tasks, interleaved newest completion first. */
export function CompletedView({
  tasks,
  occurrences,
  onChanged,
  onSelect,
}: CompletedViewProps): JSX.Element {
  const rows: HistoryRow[] = [
    ...tasks.map((task): HistoryRow => ({
      kind: "task",
      completedAt: task.completed_at ?? "",
      task,
    })),
    ...occurrences.map((occurrence): HistoryRow => ({
      kind: "occurrence",
      completedAt: occurrence.completed_at,
      occurrence,
    })),
  ].sort((a, b) => b.completedAt.localeCompare(a.completedAt));

  async function reopen(task: Task): Promise<void> {
    const updated = await updateTask(task.id, { completed: !task.completed });
    onChanged((current) => current.map((t) => (t.id === updated.id ? updated : t)));
  }

  async function remove(task: Task): Promise<void> {
    await deleteTask(task.id);
    onChanged((current) => current.filter((t) => t.id !== task.id));
  }

  return (
    <div className="task-groups">
      <ul className="tasks completed-history" aria-label="Completed">
        {rows.map((row) =>
          row.kind === "task" ? (
            <li key={`task-${row.task.id}`} data-priority={row.task.priority}>
              <label>
                <input
                  type="checkbox"
                  checked={row.task.completed}
                  aria-label={`Complete ${row.task.title}`}
                  onChange={() => void reopen(row.task)}
                />
              </label>
              <button
                type="button"
                className="task-title"
                aria-label={`Open details for ${row.task.title}`}
                onClick={() => onSelect(row.task.id)}
              >
                <span className="completed">{row.task.title}</span>
                {row.task.completed_at !== null && (
                  <span className="date-chip">{localDayOf(new Date(row.task.completed_at))}</span>
                )}
              </button>
              <button
                type="button"
                aria-label={`Delete ${row.task.title}`}
                onClick={() => void remove(row.task)}
              >
                Delete
              </button>
            </li>
          ) : (
            <li
              key={`occurrence-${row.occurrence.id}`}
              className="occurrence"
              aria-label={`Completed occurrence of ${row.occurrence.title}`}
            >
              <span className="repeat-glyph" aria-hidden="true">
                <Icon name="repeat" size={14} />
              </span>
              <span className="completed">{row.occurrence.title}</span>
              <span className="date-chip">{localDayOf(new Date(row.occurrence.completed_at))}</span>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
