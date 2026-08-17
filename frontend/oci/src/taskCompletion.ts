/** The undoable "complete a Task" flow (issue #155), shared by every view
 * that offers a checkbox on a Task: the List view and the Kanban board so
 * far. Extracted so the two can't drift onto two different completion
 * behaviors — there is exactly one way completing a Task behaves, whichever
 * surface it's clicked from.
 *
 * Completing defers the PATCH behind the caller's `UndoQueue` (taken as a
 * parameter, not created here, so a view that also queues other undoable
 * actions — e.g. the List view's delete — can share one queue and one
 * `<ToastStack>` rather than juggling several). Reopening an already-
 * completed Task doesn't go through the queue at all — there is nothing to
 * undo, since the Task was already sitting there completed. A recurring
 * Task's completion is a server-side branch (ADR 0003: advance in place +
 * write a Completed Occurrence) — this hook doesn't need to know that; it
 * just issues the same `{ completed: true }` PATCH either way once the
 * toast's window elapses. */
import { useState } from "react";

import { updateTask, type Task } from "./api";
import { type UndoQueue } from "./undoQueue";

export interface TaskCompletion {
  /** Whether a completion for this Task is queued but not yet committed —
   * render the row/card as completed without waiting for the PATCH. */
  isPending: (taskId: number) => boolean;
  /** Wire directly to a checkbox's onChange/onToggle. */
  toggle: (task: Task) => void;
}

export function useTaskCompletion(
  onChanged: (update: (current: Task[]) => Task[]) => void,
  undoQueue: UndoQueue,
): TaskCompletion {
  // Task ids with a completion pending: greyed out like a completed Task
  // without actually setting `completed` (a recurring Task never does), and
  // mapped to the queue entry so re-clicking the checkbox can cancel it.
  const [pendingComplete, setPendingComplete] = useState<Map<number, number>>(new Map());

  function clearPendingComplete(taskId: number): void {
    setPendingComplete((current) => {
      if (!current.has(taskId)) {
        return current;
      }
      const next = new Map(current);
      next.delete(taskId);
      return next;
    });
  }

  async function reopen(task: Task): Promise<void> {
    const updated = await updateTask(task.id, { completed: false });
    onChanged((current) => current.map((t) => (t.id === updated.id ? updated : t)));
  }

  function startComplete(task: Task): void {
    const entryId = undoQueue.push(
      "Completed",
      async () => {
        const updated = await updateTask(task.id, { completed: true });
        onChanged((current) => current.map((t) => (t.id === updated.id ? updated : t)));
        clearPendingComplete(task.id);
      },
      () => clearPendingComplete(task.id),
    );
    setPendingComplete((current) => new Map(current).set(task.id, entryId));
  }

  function toggle(task: Task): void {
    const pendingEntryId = pendingComplete.get(task.id);
    if (pendingEntryId !== undefined) {
      // A second click while completion is pending cancels it, same as Undo.
      undoQueue.undo(pendingEntryId);
    } else if (task.completed) {
      void reopen(task);
    } else {
      startComplete(task);
    }
  }

  return {
    isPending: (taskId) => pendingComplete.has(taskId),
    toggle,
  };
}
