import { Icon } from "./Icon";

interface BulkActionBarProps {
  /** How many Tasks are selected — shown, and announced. */
  count: number;
  onComplete: () => void;
  onReschedule: () => void;
  onMove: () => void;
  onAddTag: () => void;
  onDelete: () => void;
  onClear: () => void;
}

/** The bar that appears over the task list while rows are selected (issue
 * #202): a count plus the five verbs that act on the whole selection —
 * complete, reschedule, move to List, add Tag, delete. Every write goes one
 * Task at a time against the existing per-Task endpoint (there is no bulk
 * route), on the same undo path a single row uses. */
export function BulkActionBar({
  count,
  onComplete,
  onReschedule,
  onMove,
  onAddTag,
  onDelete,
  onClear,
}: BulkActionBarProps): JSX.Element {
  return (
    <div className="bulk-action-bar" role="toolbar" aria-label="Bulk actions">
      <span className="bulk-action-count" aria-live="polite">
        {count} selected
      </span>
      <button type="button" onClick={onComplete}>
        Complete
      </button>
      <button type="button" onClick={onReschedule}>
        Reschedule
      </button>
      <button type="button" onClick={onMove}>
        Move to list
      </button>
      <button type="button" onClick={onAddTag}>
        Add tag
      </button>
      <button type="button" className="row-action-danger" onClick={onDelete}>
        Delete
      </button>
      <button
        type="button"
        className="bulk-action-clear"
        aria-label="Clear selection"
        onClick={onClear}
      >
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}
