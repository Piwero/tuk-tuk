import { type UndoToastEntry } from "../undoQueue";
import { Icon } from "./Icon";

interface ToastStackProps {
  entries: UndoToastEntry[];
  onUndo: (id: number) => void;
  onDismiss: (id: number) => void;
}

/** Transient "message — Undo" notifications for reversible actions (issue
 * #155: deleting or completing a Task). Each toast's lifetime is owned by
 * the caller's useUndoQueue — this component only renders whatever's
 * currently pending and reports clicks back.
 *
 * `role="status"` + `aria-live="polite"` announce a new toast without
 * stealing focus. Undo and Dismiss are ordinary buttons, so they're already
 * reachable by Tab and activatable with Enter/Space. */
export function ToastStack({ entries, onUndo, onDismiss }: ToastStackProps): JSX.Element | null {
  if (entries.length === 0) {
    return null;
  }
  return (
    <div className="toast-stack">
      {entries.map((entry) => (
        <div key={entry.id} className="toast" role="status" aria-live="polite">
          <span className="toast-message">{entry.message}</span>
          <button type="button" className="toast-undo" onClick={() => onUndo(entry.id)}>
            Undo
          </button>
          <button
            type="button"
            className="toast-dismiss"
            aria-label="Dismiss"
            onClick={() => onDismiss(entry.id)}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
