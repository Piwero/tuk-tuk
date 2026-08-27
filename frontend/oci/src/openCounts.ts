/** Sidebar open-Task counts, derived client-side (issue #195).
 *
 * Every Smart List, the Inbox, each Folder and each List shows how many open
 * Tasks it holds. The numbers are computed from the Tasks the client already
 * holds — a single-user app needs no aggregate endpoint, and deriving keeps
 * the counts correct the moment a Task changes rather than after a refetch.
 *
 * Scope guard: open Tasks only. A completed Task never counts; Completed
 * Occurrences are a separate history record and never reach here. Tags get
 * no count at all.
 */

import { type SmartView, type Task } from "./api";
import { entryDayWindow } from "./calendar";
import { addDays } from "./dates";

export interface OpenTaskCounts {
  /** Open-Task count per Smart List. "all" is every open Task. */
  smart: Record<SmartView, number>;
  /** Open-Task count per List id (the Inbox is just another List here).
   * A List with no open Tasks is absent rather than mapped to 0. */
  byList: Map<number, number>;
}

/** Whether an open Task falls in a date-window Smart List, mirroring the
 * backend's rule (see the fake API's `inSmartView`): "today" is everything
 * due today or overdue, "next 7 days" is the week-long window from today. */
function inSmartWindow(task: Task, view: "today" | "next7", today: string): boolean {
  const window = entryDayWindow(task);
  if (window === null) {
    return false;
  }
  const [first, last] = window;
  if (view === "today") {
    return first <= today;
  }
  return first <= addDays(today, 6) && last >= today;
}

/** Fold the open Tasks the client holds into the sidebar's counts. `today`
 * is the caller's local day (YYYY-MM-DD). Completed Tasks are ignored. */
export function deriveOpenTaskCounts(openTasks: Task[], today: string): OpenTaskCounts {
  const smart: Record<SmartView, number> = { today: 0, next7: 0, all: 0 };
  const byList = new Map<number, number>();
  for (const task of openTasks) {
    if (task.completed) {
      continue;
    }
    byList.set(task.list_id, (byList.get(task.list_id) ?? 0) + 1);
    smart.all += 1;
    if (inSmartWindow(task, "today", today)) {
      smart.today += 1;
    }
    if (inSmartWindow(task, "next7", today)) {
      smart.next7 += 1;
    }
  }
  return { smart, byList };
}

/** A Folder's count is the sum of its Lists' counts. */
export function folderOpenCount(byList: Map<number, number>, listIds: number[]): number {
  return listIds.reduce((sum, id) => sum + (byList.get(id) ?? 0), 0);
}

/** How a sidebar item's open-Task count reads to assistive tech — attached
 * as the item's accessible description (issue #195) so a screen reader
 * announces "Inbox … 3 open tasks" while the visible glyph stays a bare
 * numeral. Only ever called for a non-zero count. */
export function openCountLabel(count: number): string {
  return `${count} open ${count === 1 ? "task" : "tasks"}`;
}
