import { updateTask, type Folder, type Task, type TaskList } from "../api";
import { formatSchedule, isOverdue } from "../dates";
import { sortTasks, type SortBy } from "../grouping";
import { byOrder } from "../ordering";

/** Folder view's sort choices: date, priority or title — no "custom", since
 * there's no manual order across Lists to preserve, and no drag-reordering
 * here at all (see #126). */
export type FolderSortBy = Exclude<SortBy, "custom">;

interface FolderViewProps {
  folder: Folder;
  /** The Folder's own Lists, in their sidebar order — each renders as its
   * own group, named and clickable through to that List. */
  lists: TaskList[];
  /** Tasks across every List in the Folder (fetched by the caller — no
   * single endpoint spans multiple Lists). */
  tasks: Task[];
  sortBy: FolderSortBy;
  onChanged: (update: (current: Task[]) => Task[]) => void;
  onSelect: (taskId: number) => void;
  onSelectList: (listId: number) => void;
  onStartFocus: (task: Task) => void;
}

/** The Folder view (#126): Tasks across every List in a Folder, grouped by
 * List. No Sections, no Kanban, no drag-reordering — that manual ordering
 * belongs to a single List, not a cross-List rollup. */
export function FolderView({
  folder,
  lists,
  tasks,
  sortBy,
  onChanged,
  onSelect,
  onSelectList,
  onStartFocus,
}: FolderViewProps): JSX.Element {
  async function toggle(task: Task): Promise<void> {
    const updated = await updateTask(task.id, { completed: !task.completed });
    onChanged((current) => current.map((t) => (t.id === updated.id ? updated : t)));
  }

  function renderTaskRow(task: Task): JSX.Element {
    return (
      <li key={task.id} data-priority={task.priority} data-overdue={isOverdue(task) || undefined}>
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
        </button>
        <button
          type="button"
          aria-label={`Start Focus for ${task.title}`}
          onClick={() => onStartFocus(task)}
        >
          Focus
        </button>
      </li>
    );
  }

  const orderedLists = [...lists].sort(byOrder);

  return (
    <div className="task-groups folder-view">
      {orderedLists.map((list) => {
        const listTasks = sortTasks(
          tasks.filter((task) => task.list_id === list.id),
          sortBy,
        );
        return (
          <section key={list.id} className="task-group">
            <div className="group-header">
              <h2>
                <button
                  type="button"
                  className="folder-view-list-link"
                  onClick={() => onSelectList(list.id)}
                >
                  {list.name}
                </button>
              </h2>
            </div>
            <ul className="tasks" aria-label={`Tasks in ${list.name}`}>
              {listTasks.map((task) => renderTaskRow(task))}
            </ul>
          </section>
        );
      })}
      {orderedLists.length === 0 && (
        <p className="folder-empty-hint">
          The folder “{folder.name}” has no lists yet — add one from the sidebar to see its tasks
          here.
        </p>
      )}
    </div>
  );
}
