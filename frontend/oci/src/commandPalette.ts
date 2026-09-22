/** Pure matching and grouping for the command palette (issue #201).
 *
 * The palette is a jump-only surface: every item carries a `run` that
 * navigates somewhere and nothing else — no task creation, no task verbs.
 * This module never touches the DOM; it only decides which items match a
 * query and how they bucket by kind, so the traversal order the component
 * renders is the order arrow keys walk. */

export type PaletteKind = "smart" | "view" | "list" | "folder" | "tag" | "task";

/** The verbs the palette offers when it is opened scoped to one Task
 * (issue #205) — the same set the row hides behind hover, plus the Pomo
 * quick-start the hover row used to sample (#280). A non-null
 * `pickerHeading` marks the ones that open a picker inside the palette
 * surface rather than running straight away. */
export type TaskVerbId =
  "complete" | "focus" | "pomo" | "reschedule" | "move" | "tag" | "repeat" | "delete";

export interface TaskVerb {
  id: TaskVerbId;
  label: string;
  /** Heading shown above the in-palette picker this verb opens, or null for
   * a verb that runs straight away without one. */
  pickerHeading: string | null;
}

/** The verb list for `task`, in the order arrow keys walk it. A recurring
 * Task's "complete" is relabelled so it reads as advancing an occurrence
 * rather than closing the Task (ADR 0003). A non-null `pickerHeading` is what
 * marks a verb as value-taking. */
export function taskVerbs(task: { recurrence: string | null }): TaskVerb[] {
  return [
    {
      id: "complete",
      label: task.recurrence === null ? "Complete" : "Complete this occurrence",
      pickerHeading: null,
    },
    { id: "focus", label: "Start Focus", pickerHeading: null },
    { id: "pomo", label: "Start Pomo", pickerHeading: "Start which Pomo?" },
    { id: "reschedule", label: "Reschedule", pickerHeading: "Reschedule to…" },
    { id: "move", label: "Move to a List", pickerHeading: "Move to which List?" },
    { id: "tag", label: "Add a Tag", pickerHeading: "Add which Tag?" },
    { id: "repeat", label: "Set repeat", pickerHeading: "Repeat how often?" },
    { id: "delete", label: "Delete", pickerHeading: null },
  ];
}

export interface PaletteItem {
  /** Stable and unique across the whole palette. */
  key: string;
  kind: PaletteKind;
  /** What the row shows and what the query matches against. */
  label: string;
  /** Navigate to this destination. The component closes the palette and
   * restores focus afterwards — `run` only moves the app. */
  run: () => void;
}

export interface PaletteGroup {
  kind: PaletteKind;
  heading: string;
  items: PaletteItem[];
}

/** Group display order, and the order arrow-key traversal visits them in. */
const GROUP_ORDER: PaletteKind[] = ["smart", "view", "list", "folder", "tag", "task"];

const GROUP_HEADINGS: Record<PaletteKind, string> = {
  smart: "Smart Lists",
  view: "Views",
  list: "Lists",
  folder: "Folders",
  tag: "Tags",
  task: "Tasks",
};

/** Case-insensitive: every whitespace-separated term in `query` must appear
 * somewhere in `label`. A blank query matches everything. */
export function matchesQuery(label: string, query: string): boolean {
  const haystack = label.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term !== "")
    .every((term) => haystack.includes(term));
}

/** Filters `items` by `query`, then buckets the survivors by kind in the
 * fixed group order. Empty groups are dropped; order within a group is the
 * input order. */
export function groupItems(items: PaletteItem[], query: string): PaletteGroup[] {
  const matched = items.filter((item) => matchesQuery(item.label, query));
  return GROUP_ORDER.map((kind) => ({
    kind,
    heading: GROUP_HEADINGS[kind],
    items: matched.filter((item) => item.kind === kind),
  })).filter((group) => group.items.length > 0);
}

/** The grouped items flattened back into one sequence, in render order —
 * what a single moving highlight steps through. */
export function flattenGroups(groups: PaletteGroup[]): PaletteItem[] {
  return groups.flatMap((group) => group.items);
}
