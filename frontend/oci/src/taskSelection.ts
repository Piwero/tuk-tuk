/** Multi-select state for the task list (issue #202).
 *
 * The List view is the only surface that selects Tasks — the Kanban board
 * and Calendar don't. `toggle` marks the focused row and makes it the range
 * anchor; `extendTo` selects the contiguous run between that anchor and a
 * second row, in the order the rows are visible on screen; `clear` drops the
 * whole selection (Escape, or a view change). Selection is a set of Task ids
 * so it survives a re-render that hands back new Task objects. */
import { useCallback, useState } from "react";

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

interface ScopedSelection {
  scope: string;
  ids: ReadonlySet<number>;
  anchor: number | null;
}

const NOTHING: ReadonlySet<number> = new Set();

/** `scope` names the view the selection belongs to. A selection made under one
 * scope reads as empty under any other, in the same render, so a view change
 * never shows (or acts on) the previous view's rows. Resetting in render
 * rather than in an effect also means a late-flushed effect can't wipe a
 * selection the user has just made. */
export function useTaskSelection(scope = ""): TaskSelection {
  const [state, setState] = useState<ScopedSelection>(() => ({
    scope,
    ids: NOTHING,
    anchor: null,
  }));
  const current = state.scope === scope ? state : { scope, ids: NOTHING, anchor: null };
  const selected = current.ids;

  // Every update starts from this scope's selection, never a stale one.
  const update = useCallback(
    (change: (previous: ScopedSelection) => ScopedSelection) => {
      setState((previous) =>
        change(previous.scope === scope ? previous : { scope, ids: NOTHING, anchor: null }),
      );
    },
    [scope],
  );

  const toggle = useCallback(
    (id: number) => {
      update((previous) => {
        const ids = new Set(previous.ids);
        if (ids.has(id)) {
          ids.delete(id);
        } else {
          ids.add(id);
        }
        return { ...previous, ids, anchor: id };
      });
    },
    [update],
  );

  const extendTo = useCallback(
    (id: number, orderedIds: number[]) => {
      update((previous) => {
        if (previous.anchor === null) {
          return { ...previous, ids: new Set(previous.ids).add(id), anchor: id };
        }
        const from = orderedIds.indexOf(previous.anchor);
        const to = orderedIds.indexOf(id);
        if (from === -1 || to === -1) {
          return previous;
        }
        const [lo, hi] = from < to ? [from, to] : [to, from];
        const ids = new Set(previous.ids);
        for (let index = lo; index <= hi; index += 1) {
          ids.add(orderedIds[index]!);
        }
        return { ...previous, ids };
      });
    },
    [update],
  );

  const clear = useCallback(() => {
    update((previous) => ({ ...previous, ids: NOTHING, anchor: null }));
  }, [update]);

  return {
    selected,
    isSelected: (id) => selected.has(id),
    toggle,
    extendTo,
    clear,
    size: selected.size,
  };
}
