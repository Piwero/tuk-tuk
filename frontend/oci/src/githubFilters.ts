import type { GitHubIssue, GitHubPullRequest, RepositoryViewSavedOptions } from "./api";

/** The GitHub view's filter controls (#585): which of the returned items
 * to show. Applied in the browser over the read, so they never reach the
 * backend or its cache. One set serves both tabs; a filter a tab's items
 * lack (assignee on Pull Requests) leaves that tab alone. A Repository
 * View (#580) saves these; the default "all Watched Repositories" view
 * never does. */
export interface GitHubFilters {
  /** A GitHub login, or null for anyone. */
  author: string | null;
  /** A label name, or null for any label. */
  label: string | null;
  /** A GitHub login assigned to a GitHub Issue, or null for anyone. */
  assignee: string | null;
  /** Leave out draft Pull Requests. */
  hideDrafts: boolean;
  /** Leave out items whose author GitHub flags as a bot. */
  hideBots: boolean;
}

export const NO_GITHUB_FILTERS: GitHubFilters = {
  author: null,
  label: null,
  assignee: null,
  hideDrafts: false,
  hideBots: false,
};

/** The filters a Repository View saved (#580). */
export function filtersOf(saved: RepositoryViewSavedOptions): GitHubFilters {
  return {
    author: saved.author,
    label: saved.label,
    assignee: saved.assignee,
    hideDrafts: saved.hide_drafts,
    hideBots: saved.hide_bots,
  };
}

/** `filters` as a Repository View saves them. */
export function savedFilters(
  filters: GitHubFilters,
): Omit<RepositoryViewSavedOptions, "active_tab"> {
  return {
    author: filters.author,
    label: filters.label,
    assignee: filters.assignee,
    hide_drafts: filters.hideDrafts,
    hide_bots: filters.hideBots,
  };
}

/** Anything the filters can narrow: a Pull Request or a GitHub Issue. */
export type Filterable =
  | Pick<GitHubPullRequest, "author" | "author_is_bot" | "labels" | "is_draft">
  | Pick<GitHubIssue, "author" | "author_is_bot" | "labels" | "assignees">;

function matches(item: Filterable, filters: GitHubFilters): boolean {
  if (filters.hideBots && item.author_is_bot) return false;
  if (filters.hideDrafts && "is_draft" in item && item.is_draft) return false;
  if (filters.author !== null && item.author !== filters.author) return false;
  if (filters.label !== null && !item.labels.some((label) => label.name === filters.label)) {
    return false;
  }
  if (filters.assignee !== null && "assignees" in item) {
    return item.assignees.includes(filters.assignee);
  }
  return true;
}

export function applyGitHubFilters<Item extends Filterable>(
  items: Item[],
  filters: GitHubFilters,
): Item[] {
  return items.filter((item) => matches(item, filters));
}

/** The choices each filter offers: whatever the current results hold. */
export interface GitHubFilterChoices {
  authors: string[];
  labels: string[];
  assignees: string[];
}

function distinctSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function githubFilterChoices(items: Filterable[]): GitHubFilterChoices {
  return {
    authors: distinctSorted(items.flatMap((item) => (item.author === null ? [] : [item.author]))),
    labels: distinctSorted(items.flatMap((item) => item.labels.map((label) => label.name))),
    assignees: distinctSorted(items.flatMap((item) => ("assignees" in item ? item.assignees : []))),
  };
}
