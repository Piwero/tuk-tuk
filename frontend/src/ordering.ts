/** Sparse manual ordering shared by sidebar Lists and Folders. */

/**
 * Gap between consecutive sort_order values, so a drag-reorder writes one
 * row (the moved one) instead of renumbering all siblings.
 */
export const SORT_GAP = 1024;

interface Ordered {
  id: number;
  sort_order: number;
}

export const byOrder = (a: Ordered, b: Ordered): number =>
  a.sort_order - b.sort_order || a.id - b.id;

export const byName = (a: { name: string; id: number }, b: { name: string; id: number }): number =>
  a.name.localeCompare(b.name) || a.id - b.id;

export type InsertionPlan<T extends Ordered> =
  | { kind: "single"; sort_order: number }
  | { kind: "renumber"; rows: { row: T; sort_order: number }[] };

/**
 * Plan dropping `moved` before the sibling with `targetId`.
 * `siblings` is the sorted group without `moved`. Normally one sparse write;
 * when the gap between neighbours is exhausted, renumber the whole group.
 */
export function planInsertBefore<T extends Ordered>(
  siblings: T[],
  moved: T,
  targetId: number,
): InsertionPlan<T> {
  const targetIndex = siblings.findIndex((row) => row.id === targetId);
  const target = siblings[targetIndex];
  if (target === undefined) {
    return { kind: "single", sort_order: appendOrder(siblings) };
  }
  const prev = targetIndex > 0 ? siblings[targetIndex - 1] : undefined;
  const sortOrder =
    prev === undefined
      ? target.sort_order - SORT_GAP
      : Math.floor((prev.sort_order + target.sort_order) / 2);
  if (prev !== undefined && sortOrder <= prev.sort_order) {
    const arrangement = [...siblings];
    arrangement.splice(targetIndex, 0, moved);
    return {
      kind: "renumber",
      rows: arrangement.map((row, index) => ({ row, sort_order: (index + 1) * SORT_GAP })),
    };
  }
  return { kind: "single", sort_order: sortOrder };
}

/** Sparse order for appending after the last of `siblings`. */
export function appendOrder(siblings: Ordered[]): number {
  const last = siblings[siblings.length - 1];
  return last === undefined ? SORT_GAP : last.sort_order + SORT_GAP;
}
