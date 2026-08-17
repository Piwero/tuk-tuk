import { type Task, type TaskList } from "../api";
import { formatSchedule, isOverdue } from "../dates";
import { Icon } from "./Icon";
import { PriorityIndicator } from "./PriorityIndicator";

export interface TaskRowProps {
  task: Task;
  /** Display-only completion override, defaulting to `task.completed`. Lets a
   * call site show the row as completed before the backend confirms it — e.g.
   * during an undoable toast's window (#155), where the PATCH is deferred and
   * `task.completed` hasn't changed yet. */
  completed?: boolean;
  /** The task's own List, shown as a badge — pass this from views that span
   * multiple Lists (Smart Lists, Search); a single List's own view omits it,
   * since the badge would just repeat the page the user is already on. */
  list?: TaskList;
  /** Metadata visibility, chosen deliberately by the call site rather than
   * inferred from context (#157 — a Task looked like a different object
   * depending on where it was rendered). */
  showDate: boolean;
  showTags: boolean;
  showCheckProgress: boolean;
  onToggle: (task: Task) => void;
  onSelect: (taskId: number) => void;
  /** Row actions — each optional; a view wires only what it offers. */
  onStartFocus?: (task: Task) => void;
  onKebabClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onDelete?: (task: Task) => void;
  draggable?: boolean;
  onDragStart?: (event: React.DragEvent<HTMLLIElement>) => void;
  onDragEnd?: (event: React.DragEvent<HTMLLIElement>) => void;
  onDragOver?: (event: React.DragEvent<HTMLLIElement>) => void;
  onDrop?: (event: React.DragEvent<HTMLLIElement>) => void;
  onContextMenu?: (event: React.MouseEvent<HTMLLIElement>) => void;
}

/** The single row a Task renders as, wherever it's met: the List view,
 * Smart Lists, and Search results (#157). Two lines, always — the title
 * gets the full row width on its own line and is the only thing that ever
 * truncates; metadata (list/date/tag chips, the Check Item counter, row
 * actions) wraps freely on the line below, so it can never squeeze the
 * title down to nothing on a narrow viewport. */
export function TaskRow({
  task,
  completed = task.completed,
  list,
  showDate,
  showTags,
  showCheckProgress,
  onToggle,
  onSelect,
  onStartFocus,
  onKebabClick,
  onDelete,
  draggable,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onContextMenu,
}: TaskRowProps): JSX.Element {
  const overdue = isOverdue(task);
  const hasDescription = task.description.trim() !== "";
  const schedule = formatSchedule(task);
  const hasActions = onStartFocus !== undefined || onDelete !== undefined;

  return (
    <li
      className="task-row"
      data-priority={task.priority}
      data-overdue={overdue || undefined}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
    >
      <div className="task-row-head">
        <label>
          <input
            type="checkbox"
            checked={completed}
            aria-label={`Complete ${task.title}`}
            onChange={() => onToggle(task)}
          />
        </label>
        <button
          type="button"
          className="task-title"
          aria-label={`Open details for ${task.title}`}
          onClick={() => onSelect(task.id)}
        >
          <span className={completed ? "completed" : undefined}>{task.title}</span>
          {hasDescription && (
            <span
              className="description-indicator"
              title="Has a description"
              aria-label="Has a description"
            >
              <Icon name="align-left" size={14} />
            </span>
          )}
        </button>
      </div>
      <div className="task-row-meta">
        <PriorityIndicator priority={task.priority} />
        {list !== undefined && (
          <span
            className="list-chip"
            style={list.color === null ? undefined : { borderColor: list.color }}
          >
            {list.emoji !== null ? `${list.emoji} ` : ""}
            {list.name}
          </span>
        )}
        {showDate && task.due_date !== null && (
          <span className={overdue ? "date-chip overdue" : "date-chip"}>{schedule}</span>
        )}
        {showTags &&
          task.tags.map((tag) => (
            <span
              key={tag.id}
              className="tag-chip"
              style={tag.color === null ? undefined : { borderColor: tag.color }}
            >
              {tag.name}
            </span>
          ))}
        {showCheckProgress && task.check_items.length > 0 && (
          <span className="check-progress">
            {task.check_items.filter((item) => item.done).length}/{task.check_items.length}
          </span>
        )}
        {hasActions && (
          <span className="row-actions">
            {onStartFocus !== undefined && onKebabClick !== undefined && (
              <button
                type="button"
                aria-label={`Pomo quick-start menu for ${task.title}`}
                onClick={onKebabClick}
              >
                <Icon name="more-vertical" />
              </button>
            )}
            {onStartFocus !== undefined && (
              <button
                type="button"
                aria-label={`Start Focus for ${task.title}`}
                onClick={() => onStartFocus(task)}
              >
                <Icon name="timer" />
              </button>
            )}
            {onDelete !== undefined && (
              <button
                type="button"
                className="row-action-danger"
                aria-label={`Delete ${task.title}`}
                onClick={() => onDelete(task)}
              >
                <Icon name="trash-2" />
              </button>
            )}
          </span>
        )}
      </div>
    </li>
  );
}
