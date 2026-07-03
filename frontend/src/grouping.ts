/** Pure grouping and sorting for the List view. */

import { type Priority, type Section, type Task } from "./api";
import { byOrder } from "./ordering";

export type GroupBy = "section" | "date" | "priority";
export type SortBy = "custom" | "date" | "priority" | "title";

export interface TaskGroup {
  key: string;
  /** null when the view is a single flat block without a heading. */
  label: string | null;
  /** Set for section groups: a Section id, or null for "No section". */
  sectionId: number | null | undefined;
  tasks: Task[];
}

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2, none: 3 };
const PRIORITY_GROUP_LABELS: Record<Priority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
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
    case "date": // Tasks carry no dates yet; fall back to the custom order.
    case "custom":
      sorted.sort(byOrder);
      break;
  }
  return sorted;
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
    // Tasks carry no dates yet (scheduling is a later slice): one bucket.
    return [
      { key: "date-none", label: "No date", sectionId: undefined, tasks: sortTasks(tasks, sortBy) },
    ];
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
