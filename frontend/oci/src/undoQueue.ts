/** A queue of undoable actions, each held for a short window before it
 * commits (issue #155).
 *
 * The action never runs until its window elapses or the caller dismisses it
 * early — `push`'s `commit` callback is the only thing that talks to the
 * backend. Undo is then just "never call it": no server round-trip, no
 * inverse operation to get right. This is why deleting or completing a Task
 * can be undone without a dedicated restore endpoint — the DELETE/PATCH
 * request itself is what's deferred.
 *
 * At most one timer per pushed entry; `push` returns the entry's id so a
 * caller can cancel it early through a second means than the toast itself
 * (e.g. clicking a checkbox again).
 */
import { useCallback, useRef, useState } from "react";

export interface UndoToastEntry {
  id: number;
  message: string;
}

interface PendingEntry {
  commit: () => void | Promise<void>;
  undo: () => void;
  timer: ReturnType<typeof setTimeout>;
}

/** The minimum time an undo toast stays up (issue #155's "at least 5s"). */
export const UNDO_WINDOW_MS = 5_000;

export interface UndoQueue {
  /** The toasts to render, oldest first. */
  entries: UndoToastEntry[];
  /** Queues `commit` to run after `windowMs`; returns an id that `undo` or
   * `dismiss` can resolve early. */
  push: (message: string, commit: () => void | Promise<void>, undo: () => void) => number;
  /** Cancels the pending commit and runs its `undo` instead. */
  undo: (id: number) => void;
  /** Ends the window early and runs `commit` right away. */
  dismiss: (id: number) => void;
}

export function useUndoQueue(windowMs: number = UNDO_WINDOW_MS): UndoQueue {
  const [entries, setEntries] = useState<UndoToastEntry[]>([]);
  const pending = useRef(new Map<number, PendingEntry>());
  const nextId = useRef(0);

  const resolve = useCallback((id: number, mode: "commit" | "undo") => {
    const entry = pending.current.get(id);
    if (entry === undefined) {
      return;
    }
    clearTimeout(entry.timer);
    pending.current.delete(id);
    setEntries((current) => current.filter((e) => e.id !== id));
    if (mode === "commit") {
      void entry.commit();
    } else {
      entry.undo();
    }
  }, []);

  const push = useCallback(
    (message: string, commit: () => void | Promise<void>, undo: () => void): number => {
      const id = nextId.current;
      nextId.current += 1;
      const timer = setTimeout(() => resolve(id, "commit"), windowMs);
      pending.current.set(id, { commit, undo, timer });
      setEntries((current) => [...current, { id, message }]);
      return id;
    },
    [resolve, windowMs],
  );

  const undo = useCallback((id: number) => resolve(id, "undo"), [resolve]);
  const dismiss = useCallback((id: number) => resolve(id, "commit"), [resolve]);

  return { entries, push, undo, dismiss };
}
