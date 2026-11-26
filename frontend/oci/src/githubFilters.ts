import type { GitHubPullRequest } from "./api";

/** The GitHub view's filter controls (#585): which of the returned items
 * to show. Applied in the browser over the read, so they never reach the
 * backend or its cache. A Repository View (#580) saves these; the default
 * "all Watched Repositories" view never does. */
export interface GitHubFilters {
  /** A GitHub login, or null for anyone. */
  author: string | null;
  /** A label name, or null for any label. */
  label: string | null;
}

export const NO_GITHUB_FILTERS: GitHubFilters = {
  author: null,
  label: null,
};

/** Anything the filters can narrow: a Pull Request or a GitHub Issue. */
export type Filterable = Pick<GitHubPullRequest, "author" | "labels">;

export function applyGitHubFilters<Item extends Filterable>(
  items: Item[],
  filters: GitHubFilters,
): Item[] {
  return items.filter(
    (item) =>
      (filters.author === null || item.author === filters.author) &&
      (filters.label === null || item.labels.some((label) => label.name === filters.label)),
  );
}

/** The choices each filter offers: whatever the current results hold. */
export interface GitHubFilterChoices {
  authors: string[];
  labels: string[];
}

function distinctSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function githubFilterChoices(items: Filterable[]): GitHubFilterChoices {
  return {
    authors: distinctSorted(items.flatMap((item) => (item.author === null ? [] : [item.author]))),
    labels: distinctSorted(items.flatMap((item) => item.labels.map((label) => label.name))),
  };
}
