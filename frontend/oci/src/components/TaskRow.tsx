import { useRef, useState } from "react";

import { type Task, type TaskList } from "../api";
import { formatSchedule, isDueToday, isOverdue } from "../dates";
import { Icon } from "./Icon";
import { PriorityIndicator } from "./PriorityIndicator";

/** Carries a user-chosen Tag colour into CSS as a custom property, where the
 * chip's tint and its ink are both mixed from it. Keeps the curated 12-swatch
 * palette from having to grow a hand-picked second entry per colour. */
function chipColor(color: string | null): React.CSSProperties | undefined {
  return color === null ? undefined : ({ ["--chip-color"]: color } as React.CSSProperties);
}

/** Wraps the first case-insensitive occurrence of `query` in `title` with a
 * `<mark>` — plain text either side, or the whole title unmarked when there
 * is no match (a Search result can match on description or a Check Item
 * instead of the title) or no query at all. */
function highlightedTitle(title: string, query: string | undefined): React.ReactNode {
  const trimmed = query?.trim() ?? "";
  if (trimmed === "") {
    return title;
  }
  const index = title.toLowerCase().indexOf(trimmed.toLowerCase());
  if (index === -1) {
    return title;
  }
  return (
    <>
      {title.slice(0, index)}
      <mark>{title.slice(index, index + trimmed.length)}</mark>
      {title.slice(index + trimmed.length)}
    </>
  );
}

/** How long a touch has to hold still before Focus/Delete reveal (#168).
 * Long enough that a scroll or a normal tap never trips it, short enough
 * not to feel unresponsive. */
const LONG_PRESS_MS = 500;

export interface TaskRowProps {
  task: Task;
  /** Display-only completion override, defaulting to `task.completed`. Lets a
   * call site show the row as completed before the backend confirms it — e.g.
   * during an undoable toast's window (#155), where the PATCH is deferred and
   * `task.completed` hasn't changed yet. */
  completed?: boolean;
  /** Appended alongside the row's own "task-row" class — lets a call site
   * restyle the `<li>` for its layout (e.g. the Kanban board's card look,
   * #165) without forking the metadata markup itself. */
  className?: string;
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
  /** The substring (typically a search query) to mark within the title —
   * absent everywhere but Search results (issue #167). Matches
   * case-insensitively; only the first occurrence is marked. */
  highlight?: string;
  onToggle: (task: Task) => void;
  onSelect: (taskId: number) => void;
  /** Row actions — each optional; a view wires only what it offers. */
  onStartFocus?: (task: Task) => void;
  onKebabClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onDelete?: (task: Task) => void;
  /** Opens the command palette scoped to this Task (issue #205) — the full
   * verb set the hover actions only sample. Keyboard-reachable like every
   * other row action. */
  onOpenActions?: (task: Task) => void;
  draggable?: boolean;
  onDragStart?: (event: React.DragEvent<HTMLLIElement>) => void;
  onDragEnd?: (event: React.DragEvent<HTMLLIElement>) => void;
  onDragOver?: (event: React.DragEvent<HTMLLIElement>) => void;
  onDrop?: (event: React.DragEvent<HTMLLIElement>) => void;
  onContextMenu?: (event: React.MouseEvent<HTMLLIElement>) => void;
  /** Multi-select (issue #202), wired only by the List view. When set, the
   * row is focusable: `x` marks it (Shift+`x` extends the range from the
   * last-marked row), Escape clears the whole selection. */
  selectable?: boolean;
  selected?: boolean;
  onSelectToggle?: (shiftKey: boolean) => void;
  onSelectionClear?: () => void;
}

/** The single row a Task renders as, wherever it's met: the List view,
 * Smart Lists, and Search results (#157).
 *
 * The row's seven cells — done, priority, title, tags, List, due date,
 * actions — are laid out by `.tasks li.task-row` as a CSS grid with fixed
 * tracks either side of a flexing title, so every row puts the same thing at
 * the same x and a long list reads down each column rather than zig-zagging.
 * Each cell is rendered whether or not it has content, because an omitted
 * cell would shift every cell after it into the wrong track.
 *
 * `task-row-head` and `task-row-meta` group those cells but draw no box of
 * their own in the list: the grid gives them `display: contents` so their
 * children become the row's own grid items. They stay real boxes on a Kanban
 * card (`.kanban-card` is this same `<li>`, restyled — #165), which is what
 * keeps the card a two-line card while the row is one aligned line. */
export function TaskRow({
  task,
  completed = task.completed,
  className,
  list,
  showDate,
  showTags,
  showCheckProgress,
  highlight,
  onToggle,
  onSelect,
  onStartFocus,
  onKebabClick,
  onDelete,
  onOpenActions,
  draggable,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onContextMenu,
  selectable,
  selected,
  onSelectToggle,
  onSelectionClear,
}: TaskRowProps): JSX.Element {
  const overdue = isOverdue(task);
  const hasDescription = task.description.trim() !== "";
  const schedule = formatSchedule(task);
  const hasActions =
    onStartFocus !== undefined || onDelete !== undefined || onOpenActions !== undefined;

  // Today's date reads in the accent, everything else in the secondary ink —
  // the accent used to be on every dated row, which made it mean nothing.
  // Overdue still wins, and still owns the only red on the row.
  const dateClass = overdue
    ? "date-chip overdue"
    : !completed && isDueToday(task)
      ? "date-chip today"
      : "date-chip";

  // `with-actions` opens the reserved actions track. Without it the track is
  // 0 wide, so a view that wires no row actions loses nothing to the gutter.
  const rowClassName = ["task-row", hasActions ? "with-actions" : null, className]
    .filter((part) => part !== null && part !== undefined)
    .join(" ");

  // Focus/Delete stay off-screen at rest on touch (CSS, `[data-actions-
  // open]`) — a mis-tap must not be able to trigger a no-confirmation
  // Delete. A long-press is the deliberate gesture that reveals them; a
  // plain tap or a scroll never does (#168).
  const [actionsOpen, setActionsOpen] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  function clearPressTimer(): void {
    if (pressTimer.current !== null) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  function handleTouchStart(): void {
    longPressed.current = false;
    clearPressTimer();
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      setActionsOpen(true);
    }, LONG_PRESS_MS);
  }

  function handleTouchEnd(event: React.TouchEvent<HTMLLIElement>): void {
    clearPressTimer();
    if (longPressed.current) {
      // Swallow the trailing synthetic click so revealing the actions
      // doesn't also open the task or toggle its checkbox.
      event.preventDefault();
    }
  }

  function handleSelectionKeyDown(event: React.KeyboardEvent<HTMLLIElement>): void {
    if (!selectable) {
      return;
    }
    if (event.key === "x" || event.key === "X") {
      event.preventDefault();
      onSelectToggle?.(event.shiftKey);
    } else if (event.key === "Escape") {
      onSelectionClear?.();
    }
  }

  return (
    <li
      className={rowClassName}
      data-priority={task.priority}
      data-overdue={overdue || undefined}
      data-actions-open={actionsOpen || undefined}
      data-selected={selected || undefined}
      aria-selected={selectable ? Boolean(selected) : undefined}
      tabIndex={selectable ? 0 : undefined}
      onKeyDown={selectable ? handleSelectionKeyDown : undefined}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={clearPressTimer}
      onTouchCancel={clearPressTimer}
      onClick={() => setActionsOpen(false)}
    >
      <div className="task-row-head">
        {selectable && selected && <span className="visually-hidden">{task.title} selected</span>}
        <label>
          <input
            type="checkbox"
            checked={completed}
            aria-label={`Complete ${task.title}`}
            onChange={() => onToggle(task)}
          />
        </label>
        {/* Rendered even at Priority None, where PriorityIndicator draws
            nothing: the empty box is what keeps every title on one x. */}
        <span className="task-row-priority">
          <PriorityIndicator priority={task.priority} />
        </span>
        <span className="task-row-main">
          <button
            type="button"
            className="task-title"
            aria-label={`Open details for ${task.title}`}
            onClick={() => onSelect(task.id)}
          >
            <span className={completed ? "completed" : undefined}>
              {highlightedTitle(task.title, highlight)}
            </span>
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
          {showCheckProgress && task.check_items.length > 0 && (
            <span className="check-progress">
              {task.check_items.filter((item) => item.done).length}/{task.check_items.length}
            </span>
          )}
        </span>
      </div>
      <div className="task-row-meta">
        <span className="task-row-tags">
          {showTags &&
            task.tags.map((tag) => (
              <span key={tag.id} className="tag-chip" style={chipColor(tag.color)}>
                {tag.name}
              </span>
            ))}
        </span>
        <span className="task-row-list">
          {list !== undefined && (
            <span className="list-chip">
              {list.emoji === null ? (
                <span
                  className="color-dot"
                  style={{ background: list.color ?? "var(--border-strong)" }}
                />
              ) : (
                <span className="list-emoji">{list.emoji}</span>
              )}
              <span className="list-name">{list.name}</span>
            </span>
          )}
        </span>
        <span className="task-row-date">
          {showDate && task.due_date !== null && <span className={dateClass}>{schedule}</span>}
        </span>
        {hasActions && (
          <span className="row-actions">
            {onOpenActions !== undefined && (
              <button
                type="button"
                aria-label={`Actions for ${task.title}`}
                onClick={() => onOpenActions(task)}
              >
                <Icon name="list-checks" />
              </button>
            )}
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
