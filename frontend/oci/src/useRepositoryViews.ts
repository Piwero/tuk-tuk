import { useCallback, useEffect, useState } from "react";

import {
  createRepositoryView,
  deleteRepositoryView,
  fetchRepositoryViews,
  type RepositoryView,
  type RepositoryViewChanges,
  updateRepositoryView,
} from "./api";

export interface RepositoryViews {
  /** In sidebar order; null until first loaded. */
  views: RepositoryView[] | null;
  create: (name: string, watchedRepositoryIds: number[]) => Promise<RepositoryView>;
  /** Saves `changes` at once on screen, then on the server. */
  update: (viewId: number, changes: RepositoryViewChanges) => Promise<void>;
  remove: (viewId: number) => Promise<void>;
  /** Moves a view one place up (-1) or down (+1) in the sidebar. */
  move: (viewId: number, by: -1 | 1) => Promise<void>;
  /** Reads them again, after Watched Repositories change elsewhere. */
  reload: () => void;
}

function bySortOrder(a: RepositoryView, b: RepositoryView): number {
  return a.sort_order - b.sort_order || a.id - b.id;
}

/** The User's Repository Views (#580), shared by the sidebar, which lists
 * them, and the GitHub view, which opens and saves one. */
export function useRepositoryViews(): RepositoryViews {
  const [views, setViews] = useState<RepositoryView[] | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchRepositoryViews().then(
      (loaded) => {
        if (!cancelled) setViews([...loaded].sort(bySortOrder));
      },
      () => {
        // The sidebar just lists none; the GitHub view still works.
        if (!cancelled) setViews((current) => current ?? []);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [generation]);

  const patchLocal = useCallback((viewId: number, changes: RepositoryViewChanges): void => {
    setViews(
      (current) =>
        current?.map((v) => (v.id === viewId ? { ...v, ...changes } : v)).sort(bySortOrder) ?? null,
    );
  }, []);

  const create = useCallback(async (name: string, watchedRepositoryIds: number[]) => {
    const created = await createRepositoryView(name, watchedRepositoryIds);
    setViews((current) => [...(current ?? []), created].sort(bySortOrder));
    return created;
  }, []);

  const update = useCallback(
    async (viewId: number, changes: RepositoryViewChanges) => {
      patchLocal(viewId, changes);
      patchLocal(viewId, await updateRepositoryView(viewId, changes));
    },
    [patchLocal],
  );

  const remove = useCallback(async (viewId: number) => {
    await deleteRepositoryView(viewId);
    setViews((current) => current?.filter((v) => v.id !== viewId) ?? null);
  }, []);

  const move = useCallback(
    async (viewId: number, by: -1 | 1) => {
      const ordered = views ?? [];
      const index = ordered.findIndex((v) => v.id === viewId);
      const neighbour = ordered[index + by];
      const moved = ordered[index];
      if (moved === undefined || neighbour === undefined) return;
      // Swapping places with the neighbour rewrites just those two.
      await Promise.all([
        update(moved.id, { sort_order: neighbour.sort_order }),
        update(neighbour.id, { sort_order: moved.sort_order }),
      ]);
    },
    [views, update],
  );

  const reload = useCallback(() => setGeneration((n) => n + 1), []);

  return { views, create, update, remove, move, reload };
}
