import { useEffect, useState } from "react";

import {
  type AccessibleRepository,
  ApiError,
  fetchRepositoryPicker,
  type GitHubToken,
  type RepositoryPicker,
  type RepositoryPickerToken,
  unwatchRepository,
  watchRepository,
} from "../api";

/** Codes whose server message already says what went wrong and what to do
 * next. Anything else gets the generic retry line. */
const EXPLAINED_CODES = new Set([
  "github_repository_already_watched",
  "github_repository_not_readable",
  "github_token_rejected",
  "github_unavailable",
]);

function byName(a: { full_name: string }, b: { full_name: string }): number {
  return a.full_name.toLowerCase().localeCompare(b.full_name.toLowerCase());
}

/** The repositories whose `owner/name` contains `query`, ignoring case,
 * in name order. */
function matching(repositories: AccessibleRepository[], query: string): AccessibleRepository[] {
  const needle = query.trim().toLowerCase();
  return repositories.filter((repo) => repo.full_name.toLowerCase().includes(needle)).sort(byName);
}

/** Why one token contributes nothing to the picker, or null when it does. */
function tokenNote(token: RepositoryPickerToken): string | null {
  const theToken =
    token.owner_login === null
      ? "the token whose owner isn’t known yet"
      : `the ${token.owner_login} token`;
  if (token.status === "unavailable") {
    return `GitHub couldn’t be reached for ${theToken}’s repositories. Try again in a moment.`;
  }
  if (token.status === "needs_reconnect") {
    return `GitHub no longer accepts ${theToken}. Replace it to pick its repositories.`;
  }
  if (token.repository_count === 0) {
    return `GitHub lists no repositories for ${theToken}. An organisation may need to allow or approve fine-grained tokens before its repositories can be read: check the organisation’s settings on GitHub.`;
  }
  return null;
}

/** Settings › GitHub › Watched Repositories (#581): every repository the
 * User's GitHub Tokens can read, once each, to watch or unwatch. Reloaded
 * whenever the set of tokens changes, so removing a token re-offers what
 * another token can still read. */
export function GitHubRepositoryPicker({
  tokens,
}: {
  tokens: GitHubToken[];
}): React.JSX.Element | null {
  const [picker, setPicker] = useState<RepositoryPicker | null>(null);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<ReadonlySet<number>>(new Set());
  const [toggleError, setToggleError] = useState<string | null>(null);
  const tokenKey = tokens.map((token) => token.id).join(",");

  useEffect(() => {
    let current = true;
    fetchRepositoryPicker().then(
      (fetched) => {
        if (current) setPicker(fetched);
      },
      () => {},
    );
    return () => {
      current = false;
    };
  }, [tokenKey]);

  function settle(githubRepoId: number, watchedId: number | null): void {
    setPicker((previous) =>
      previous === null
        ? previous
        : {
            ...previous,
            repositories: previous.repositories.map((repo) =>
              repo.github_repo_id === githubRepoId
                ? { ...repo, watched_repository_id: watchedId }
                : repo,
            ),
          },
    );
  }

  function toggle(repo: AccessibleRepository): void {
    const id = repo.github_repo_id;
    setToggleError(null);
    setPending((previous) => new Set(previous).add(id));
    const change =
      repo.watched_repository_id === null
        ? watchRepository(repo.github_token_id, id).then((watched) => settle(id, watched.id))
        : unwatchRepository(repo.watched_repository_id).then(
            () => settle(id, null),
            (err: unknown) => {
              // Already gone (unwatched in another tab).
              if (err instanceof ApiError && err.status === 404) {
                settle(id, null);
                return;
              }
              throw err;
            },
          );
    change
      .catch((err: unknown) => {
        setToggleError(
          err instanceof ApiError && EXPLAINED_CODES.has(err.code)
            ? err.message
            : `Couldn’t change ${repo.full_name}. Try again.`,
        );
      })
      .finally(() =>
        setPending((previous) => {
          const next = new Set(previous);
          next.delete(id);
          return next;
        }),
      );
  }

  if (tokens.length === 0) {
    return null;
  }

  return (
    <section aria-label="Watched Repositories" className="settings-section">
      <div className="settings-section-head">
        <h2>Watched Repositories</h2>
      </div>
      <div className="settings-field">
        <label htmlFor="github-repository-search">Search repositories</label>
        <input
          id="github-repository-search"
          type="search"
          placeholder="owner/name"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {picker?.tokens.map((token) => {
        const note = tokenNote(token);
        return (
          note !== null && (
            <p key={token.id} className="settings-hint">
              {note}
            </p>
          )
        );
      })}
      {picker !== null && (
        <ul aria-label="Repositories">
          {matching(picker.repositories, query).map((repo) => (
            <li key={repo.github_repo_id}>
              <label>
                <input
                  type="checkbox"
                  aria-label={repo.full_name}
                  checked={repo.watched_repository_id !== null}
                  disabled={pending.has(repo.github_repo_id)}
                  onChange={() => toggle(repo)}
                />
                {repo.full_name}
              </label>
            </li>
          ))}
        </ul>
      )}
      {toggleError !== null && <p role="alert">{toggleError}</p>}
    </section>
  );
}
