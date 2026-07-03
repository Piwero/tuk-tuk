/** Pure grouping and sorting for the List view. */

import { type Priority, type Section, type Task } from "./api";
import { addDays, dueDay, dueInstant, localDayOf } from "./dates";
import { byOrder } from "./ordering";

export type GroupBy = "section" | "date" | "priority";
// "completion" is not offered in the sort select; the completed view uses it
// to keep the server's newest-completed-first order.
export type SortBy = "custom" | "date" | "priority" | "title" | "completion";

export interface TaskGroup {
  key: string;
  /** null when the view is a single flat block without a heading. */
  label: string | null;
  /** Set for section groups: a Section id, or null for "No section". */
  sectionId: number | null | undefined;
  tasks: Task[];
}

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2, none: 3 };

/** Display names for the four named Priority levels. */
export const PRIORITY_LABELS: Record<Priority, string> = {
  none: "None",
  low: "Low",
  medium: "Medium",
  high: "High",
};

const PRIORITY_GROUP_LABELS: Record<Priority, string> = {
  ...PRIORITY_LABELS,
  none: "No priority",
};

export function sortTasks(tasks: Task[], sortBy: SortBy): Task[] {
  const sorted = [...tasks];
  switch (sortBy) {
    case "title":
      sorted.sort((a, b) => a.title.localeCompare(b.title) || byOrder(a, b));
      break;
    case "priority":
      sorted.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byOrder(a, b));
      break;
    case "date": // Earliest due first; undated tasks keep their custom order at the end.
      sorted.sort(
        (a, b) => (dueInstant(a) ?? Infinity) - (dueInstant(b) ?? Infinity) || byOrder(a, b),
      );
      break;
    case "completion": // Completed view: newest completion first.
      sorted.sort(
        (a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? "") || byOrder(a, b),
      );
      break;
    case "custom":
      sorted.sort(byOrder);
      break;
  }
  return sorted;
}

// Date buckets, in display order. "Next 7 Days" reuses the Smart List horizon:
// due after tomorrow but within seven days of today.
const DATE_BUCKETS = ["overdue", "today", "tomorrow", "next7", "later", "none"] as const;
type DateBucket = (typeof DATE_BUCKETS)[number];

const DATE_BUCKET_LABELS: Record<DateBucket, string> = {
  overdue: "Overdue",
  today: "Today",
  tomorrow: "Tomorrow",
  next7: "Next 7 Days",
  later: "Later",
  none: "No date",
};

/** Buckets by due day alone; the overdue *flag* separately ignores completed tasks. */
function dateBucket(task: Task, today: string): DateBucket {
  const day = dueDay(task);
  if (day === null) {
    return "none";
  }
  if (day < today) {
    return "overdue";
  }
  if (day === today) {
    return "today";
  }
  if (day === addDays(today, 1)) {
    return "tomorrow";
  }
  return day <= addDays(today, 7) ? "next7" : "later";
}

export function groupTasks(
  tasks: Task[],
  sections: Section[],
  groupBy: GroupBy,
  sortBy: SortBy,
): TaskGroup[] {
  if (groupBy === "priority") {
    return (Object.keys(PRIORITY_RANK) as Priority[])
      .map((level) => ({
        key: `priority-${level}`,
        label: PRIORITY_GROUP_LABELS[level],
        sectionId: undefined,
        tasks: sortTasks(
          tasks.filter((task) => task.priority === level),
          sortBy,
        ),
      }))
      .filter((group) => group.tasks.length > 0);
  }
  if (groupBy === "date") {
    const today = localDayOf(new Date());
    return DATE_BUCKETS.map((bucket) => ({
      key: `date-${bucket}`,
      label: DATE_BUCKET_LABELS[bucket],
      sectionId: undefined,
      tasks: sortTasks(
        tasks.filter((task) => dateBucket(task, today) === bucket),
        sortBy,
      ),
    })).filter((group) => group.tasks.length > 0);
  }
  const ordered = [...sections].sort(byOrder);
  if (ordered.length === 0) {
    return [{ key: "flat", label: null, sectionId: undefined, tasks: sortTasks(tasks, sortBy) }];
  }
  return [
    {
      key: "section-none",
      label: "No section",
      sectionId: null,
      tasks: sortTasks(
        tasks.filter((task) => task.section_id === null),
        sortBy,
      ),
    },
    ...ordered.map((section) => ({
      key: `section-${section.id}`,
      label: section.name,
      sectionId: section.id,
      tasks: sortTasks(
        tasks.filter((task) => task.section_id === section.id),
        sortBy,
      ),
    })),
  ];
}
