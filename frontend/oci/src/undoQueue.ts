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

/** An extra button on a toast, beside Dismiss. Undo toasts don't use this —
 * their button is the queue's own Undo. Confirmation toasts do: it's how a
 * "Added to Errands" toast offers a way to the Task it's talking about
 * (issue #191). */
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface UndoToastEntry {
  id: number;
  message: string;
  /** Whether this toast's action is reversible — i.e. whether it offers
   * Undo. False for a confirmation of something that has already happened
   * (#191); the Undo button is not merely hidden but meaningless there. */
  undoable: boolean;
  action?: ToastAction;
}

interface PendingEntry {
  commit: () => void | Promise<void>;
  undo: () => void;
  timer: ReturnType<typeof setTimeout>;
}

/** A toast with nothing to commit or reverse still needs both slots filled. */
const NOTHING = (): void => {};

/** The minimum time an undo toast stays up (issue #155's "at least 5s"). */
export const UNDO_WINDOW_MS = 5_000;

export interface UndoQueue {
  /** The toasts to render, oldest first. */
  entries: UndoToastEntry[];
  /** Queues `commit` to run after `windowMs`; returns an id that `undo` or
   * `dismiss` can resolve early. */
  push: (message: string, commit: () => void | Promise<void>, undo: () => void) => number;
  /** A toast that reverses nothing: it reports something that has already
   * happened, and disappears after the same window. */
  notify: (message: string, action?: ToastAction) => number;
  /** Cancels the pending commit and runs its `undo` instead. */
  undo: (id: number) => void;
  /** Ends the window early and runs `commit` right away. */
  dismiss: (id: number) => void;
  /** Ends every open window at once, committing each. Used on a route change
   * so no toast outlives the screen it was raised on — deliberately a commit
   * and not a drop, so navigating away from a pending delete still sends it.
   */
  clearAll: () => void;
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

  const add = useCallback(
    (entry: Omit<UndoToastEntry, "id">, commit?: () => void | Promise<void>, undo?: () => void) => {
      const id = nextId.current;
      nextId.current += 1;
      const timer = setTimeout(() => resolve(id, "commit"), windowMs);
      pending.current.set(id, { commit: commit ?? NOTHING, undo: undo ?? NOTHING, timer });
      setEntries((current) => [...current, { ...entry, id }]);
      return id;
    },
    [resolve, windowMs],
  );

  const push = useCallback(
    (message: string, commit: () => void | Promise<void>, undo: () => void): number =>
      add({ message, undoable: true }, commit, undo),
    [add],
  );

  const notify = useCallback(
    (message: string, action?: ToastAction): number =>
      add({ message, undoable: false, ...(action ? { action } : {}) }),
    [add],
  );

  const undo = useCallback((id: number) => resolve(id, "undo"), [resolve]);
  const dismiss = useCallback((id: number) => resolve(id, "commit"), [resolve]);
  const clearAll = useCallback(() => {
    for (const id of [...pending.current.keys()]) {
      resolve(id, "commit");
    }
  }, [resolve]);

  return { entries, push, notify, undo, dismiss, clearAll };
}
