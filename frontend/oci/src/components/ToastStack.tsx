import { type UndoToastEntry } from "../undoQueue";
import { IconButton } from "./IconButton";

interface ToastStackProps {
  entries: UndoToastEntry[];
  onUndo: (id: number) => void;
  onDismiss: (id: number) => void;
}

/** Transient notifications: "message — Undo" for reversible actions (issue
 * #155: deleting or completing a Task), or "message — <action>" for a
 * confirmation that reverses nothing (#191: a created Task, where the action
 * is a way to reach it). Each toast's lifetime is owned by
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
          {entry.undoable && (
            <button type="button" className="toast-undo" onClick={() => onUndo(entry.id)}>
              Undo
            </button>
          )}
          {entry.action !== undefined && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                entry.action?.run();
                onDismiss(entry.id);
              }}
            >
              {entry.action.label}
            </button>
          )}
          <IconButton
            icon="x"
            size={14}
            label="Dismiss"
            className="toast-dismiss"
            onClick={() => onDismiss(entry.id)}
          />
        </div>
      ))}
    </div>
  );
}
