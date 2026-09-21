import { IconButton } from "./IconButton";

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
        Move to List
      </button>
      <button type="button" onClick={onAddTag}>
        Add Tag
      </button>
      <button type="button" className="row-action-danger" onClick={onDelete}>
        Delete
      </button>
      <IconButton
        icon="x"
        size={16}
        label="Clear selection"
        className="bulk-action-clear"
        onClick={onClear}
      />
    </div>
  );
}
