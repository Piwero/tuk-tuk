/** Task drag moves shared by the List view and the Kanban board. */

import { updateTask, type Task } from "./api";
import { sortTasks } from "./grouping";
import { appendOrder, planInsertBefore } from "./ordering";

/** Applies one or more server responses to the tasks state. */
export type ApplyTaskUpdates = (updates: Task[]) => void;

export function applierFor(
  onChanged: (update: (current: Task[]) => Task[]) => void,
): ApplyTaskUpdates {
  return (updates) =>
    onChanged((current) => current.map((t) => updates.find((u) => u.id === t.id) ?? t));
}

/**
 * Move a task before `target`, adopting the target's Section — one sparse
 * write, renumbering the sibling group when the gap is exhausted.
 */
export async function moveTaskBeforeTask(
  tasks: Task[],
  taskId: number,
  target: Task,
  apply: ApplyTaskUpdates,
): Promise<void> {
  const moved = tasks.find((t) => t.id === taskId);
  if (moved === undefined || taskId === target.id) {
    return;
  }
  const siblings = sortTasks(
    tasks.filter((t) => t.section_id === target.section_id && t.id !== taskId),
    "custom",
  );
  const plan = planInsertBefore(siblings, moved, target.id);
  if (plan.kind === "single") {
    apply([
      await updateTask(taskId, { section_id: target.section_id, sort_order: plan.sort_order }),
    ]);
    return;
  }
  apply(
    await Promise.all(
      plan.rows.map(({ row, sort_order }) =>
        updateTask(row.id, {
          sort_order,
          ...(row.id === taskId ? { section_id: target.section_id } : {}),
        }),
      ),
    ),
  );
}

/** Append a task to the end of a Section (null = out of any Section). */
export async function moveTaskToSectionEnd(
  tasks: Task[],
  taskId: number,
  sectionId: number | null,
  apply: ApplyTaskUpdates,
): Promise<void> {
  const siblings = sortTasks(
    tasks.filter((t) => t.section_id === sectionId && t.id !== taskId),
    "custom",
  );
  apply([await updateTask(taskId, { section_id: sectionId, sort_order: appendOrder(siblings) })]);
}
