/** Multi-select state for the task list (issue #202).
 *
 * The List view is the only surface that selects Tasks — the Kanban board
 * and Calendar don't. `toggle` marks the focused row and makes it the range
 * anchor; `extendTo` selects the contiguous run between that anchor and a
 * second row, in the order the rows are visible on screen; `clear` drops the
 * whole selection (Escape, or a view change). Selection is a set of Task ids
 * so it survives a re-render that hands back new Task objects. */
import { useCallback, useRef, useState } from "react";

export interface TaskSelection {
  selected: ReadonlySet<number>;
  isSelected: (id: number) => boolean;
  /** Toggle one row and make it the new range anchor. */
  toggle: (id: number) => void;
  /** Add every row between the anchor and `id` (inclusive) to the selection,
   * using `orderedIds` — the ids in visible order — to resolve the range.
   * With no anchor yet this just adds `id`. */
  extendTo: (id: number, orderedIds: number[]) => void;
  clear: () => void;
  size: number;
}

export function useTaskSelection(): TaskSelection {
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const anchorRef = useRef<number | null>(null);

  const toggle = useCallback((id: number) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    anchorRef.current = id;
  }, []);

  const extendTo = useCallback((id: number, orderedIds: number[]) => {
    const anchor = anchorRef.current;
    if (anchor === null) {
      setSelected((current) => new Set(current).add(id));
      anchorRef.current = id;
      return;
    }
    const from = orderedIds.indexOf(anchor);
    const to = orderedIds.indexOf(id);
    if (from === -1 || to === -1) {
      return;
    }
    const [lo, hi] = from < to ? [from, to] : [to, from];
    setSelected((current) => {
      const next = new Set(current);
      for (let index = lo; index <= hi; index += 1) {
        next.add(orderedIds[index]!);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setSelected(new Set());
    anchorRef.current = null;
  }, []);

  return {
    selected,
    isSelected: (id) => selected.has(id),
    toggle,
    extendTo,
    clear,
    size: selected.size,
  };
}
