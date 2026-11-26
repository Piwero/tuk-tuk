import "./RepositoryViewPage.css";

import { useEffect, useState } from "react";

import {
  ApiError,
  fetchWatchedRepositories,
  type RepositoryView,
  type RepositoryViewChanges,
  type WatchedRepository,
} from "../api";
import { type GitHubFilters, NO_GITHUB_FILTERS } from "../githubFilters";
import { pathForSettingsTab } from "../routes";
import type { RepositoryViews } from "../useRepositoryViews";
import { type GitHubTab, GitHubView } from "./GitHubView";

const TAB_OF: Record<RepositoryView["active_tab"], GitHubTab> = {
  pull_requests: "pull-requests",
  issues: "issues",
};

const ACTIVE_TAB_OF: Record<GitHubTab, RepositoryView["active_tab"]> = {
  "pull-requests": "pull_requests",
  issues: "issues",
};

/** What Reset puts back: no filters, on the Pull Requests tab. */
const NO_SAVED_OPTIONS: RepositoryViewChanges = {
  author: null,
  label: null,
  assignee: null,
  hide_drafts: false,
  hide_bots: false,
  active_tab: "pull_requests",
};

function filtersOf(view: RepositoryView): GitHubFilters {
  return {
    author: view.author,
    label: view.label,
    assignee: view.assignee,
    hideDrafts: view.hide_drafts,
    hideBots: view.hide_bots,
  };
}

function hasSavedOptions(view: RepositoryView): boolean {
  return (
    view.author !== null ||
    view.label !== null ||
    view.assignee !== null ||
    view.hide_drafts ||
    view.hide_bots ||
    view.active_tab !== "pull_requests"
  );
}

/** The default GitHub view over every Watched Repository: its tab and
 * filters are never saved, so leaving it drops them (#585, #580). */
export function AllWatchedGitHubView({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}): React.JSX.Element {
  const [tab, setTab] = useState<GitHubTab>("pull-requests");
  const [filters, setFilters] = useState<GitHubFilters>(NO_GITHUB_FILTERS);
  return (
    <GitHubView
      tab={tab}
      onTabChange={setTab}
      filters={filters}
      onFiltersChange={setFilters}
      onOpenSettings={onOpenSettings}
    />
  );
}

/** One Repository View (#580): the GitHub view over its Watched
 * Repositories, opening on the tab and filters it was left with. Every
 * change to them is saved; Reset clears them. Edit view renames it,
 * chooses its repositories, moves it in the sidebar or deletes it. */
export function RepositoryViewPage({
  view,
  repositoryViews,
  onOpenSettings,
  onDeleted,
}: {
  view: RepositoryView;
  repositoryViews: RepositoryViews;
  onOpenSettings: () => void;
  onDeleted: () => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const save = (changes: RepositoryViewChanges): void => {
    void repositoryViews.update(view.id, changes);
  };
  const empty = view.watched_repository_ids.length === 0;

  return (
    <div className="repository-view">
      <div className="repository-view-actions">
        {hasSavedOptions(view) && (
          <button type="button" className="btn-quiet" onClick={() => save(NO_SAVED_OPTIONS)}>
            Reset
          </button>
        )}
        {!editing && (
          <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
            Edit view
          </button>
        )}
      </div>
      {editing && (
        <RepositoryViewEditor
          view={view}
          repositoryViews={repositoryViews}
          onDone={() => setEditing(false)}
          onDeleted={onDeleted}
        />
      )}
      {empty && !editing ? (
        <div className="github-empty">
          <p>This view has no repositories.</p>
          <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
            Choose repositories
          </button>
          <a
            href={pathForSettingsTab("github")}
            onClick={(event) => {
              event.preventDefault();
              onOpenSettings();
            }}
          >
            Pick Watched Repositories in Settings
          </a>
        </div>
      ) : (
        !empty && (
          <GitHubView
            viewId={view.id}
            tab={TAB_OF[view.active_tab]}
            onTabChange={(tab) => save({ active_tab: ACTIVE_TAB_OF[tab] })}
            filters={filtersOf(view)}
            onFiltersChange={(filters) =>
              save({
                author: filters.author,
                label: filters.label,
                assignee: filters.assignee,
                hide_drafts: filters.hideDrafts,
                hide_bots: filters.hideBots,
              })
            }
            onOpenSettings={onOpenSettings}
          />
        )
      )}
    </div>
  );
}

/** Renames a Repository View, chooses its Watched Repositories, moves it
 * up or down the sidebar, or deletes it. */
function RepositoryViewEditor({
  view,
  repositoryViews,
  onDone,
  onDeleted,
}: {
  view: RepositoryView;
  repositoryViews: RepositoryViews;
  onDone: () => void;
  onDeleted: () => void;
}): React.JSX.Element {
  const [name, setName] = useState(view.name);
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(view.watched_repository_ids));
  const [watched, setWatched] = useState<WatchedRepository[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchWatchedRepositories().then(
      (rows) => {
        if (!cancelled) setWatched(rows);
      },
      () => {
        if (!cancelled) setError("Your Watched Repositories couldn’t be loaded.");
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const ordered = repositoryViews.views ?? [];
  const index = ordered.findIndex((v) => v.id === view.id);

  async function run(action: () => Promise<void>): Promise<void> {
    try {
      setError(null);
      await action();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "Something went wrong");
    }
  }

  return (
    <form
      className="repository-view-editor"
      aria-label="Edit Repository View"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (trimmed === "") return;
        void run(async () => {
          await repositoryViews.update(view.id, {
            name: trimmed,
            watched_repository_ids: [...chosen].sort((a, b) => a - b),
          });
          onDone();
        });
      }}
    >
      <label className="repository-view-name">
        View name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <fieldset>
        <legend>Repositories</legend>
        {watched !== null && watched.length === 0 && <p>You aren’t watching any repositories.</p>}
        {watched?.map((repo) => (
          <label key={repo.id} className="repository-view-repo">
            <input
              type="checkbox"
              checked={chosen.has(repo.id)}
              onChange={(event) => {
                const next = new Set(chosen);
                if (event.target.checked) next.add(repo.id);
                else next.delete(repo.id);
                setChosen(next);
              }}
            />
            {repo.full_name}
          </label>
        ))}
      </fieldset>
      {error !== null && <p role="alert">{error}</p>}
      <div className="repository-view-editor-actions">
        <button type="submit" className="btn-primary">
          Save
        </button>
        <button type="button" className="btn-quiet" onClick={onDone}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-quiet"
          disabled={index <= 0}
          onClick={() => void run(() => repositoryViews.move(view.id, -1))}
        >
          Move up
        </button>
        <button
          type="button"
          className="btn-quiet"
          disabled={index === -1 || index >= ordered.length - 1}
          onClick={() => void run(() => repositoryViews.move(view.id, 1))}
        >
          Move down
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() =>
            void run(async () => {
              await repositoryViews.remove(view.id);
              onDeleted();
            })
          }
        >
          Delete view
        </button>
      </div>
    </form>
  );
}
