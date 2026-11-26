import "./GitHubView.css";

import { useEffect, useState } from "react";

import {
  fetchGitHubIssues,
  fetchGitHubPullRequests,
  type GitHubIssue,
  type GitHubPullRequest,
  type GitHubReadOptions,
  type GitHubRepositoryRead,
  type GitHubViewRead,
  type PullRequestRelationship,
} from "../api";
import { formatTimeAgo } from "../dates";
import { pathForSettingsTab } from "../routes";
import { GitHubFreshness, GitHubStaleNotice } from "./GitHubFreshness";
import { GitHubTokenBanners } from "./GitHubTokenBanners";

/** The GitHub view's tabs: Pull Requests (#579) and GitHub Issues (#582). */
type GitHubTab = "pull-requests" | "issues";

const TABS: { tab: GitHubTab; label: string }[] = [
  { tab: "pull-requests", label: "Pull Requests" },
  { tab: "issues", label: "Issues" },
];

/** The groups, in the order the backend sorts them. */
const GROUPS: { relationship: PullRequestRelationship; label: string }[] = [
  { relationship: "review_requested", label: "Review requested" },
  { relationship: "mine", label: "Mine" },
  { relationship: "other", label: "Others" },
];

const REVIEW_LABELS: Record<GitHubPullRequest["review_decision"], string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  pending: "Review pending",
};

const CI_LABELS: Record<NonNullable<GitHubPullRequest["ci_status"]>, string> = {
  pass: "CI passing",
  fail: "CI failing",
  pending: "CI pending",
};

function labelStyle(color: string): React.CSSProperties {
  return { ["--chip-color" as string]: `#${color}` };
}

function Labels({ labels }: { labels: { name: string; color: string }[] }): React.JSX.Element {
  return (
    <>
      {labels.map((label) => (
        <span key={label.name} className="github-label" style={labelStyle(label.color)}>
          {label.name}
        </span>
      ))}
    </>
  );
}

function PullRequestRow({ pr }: { pr: GitHubPullRequest }): React.JSX.Element {
  return (
    <li className="github-row">
      <div className="github-row-title">
        <a href={pr.url} target="_blank" rel="noreferrer">
          {pr.title}
        </a>
        {pr.is_draft && <span className="github-badge">Draft</span>}
      </div>
      <div className="github-row-meta">
        <span>{`${pr.repository}#${pr.number}`}</span>
        {pr.author !== null && <span>{pr.author}</span>}
        <time dateTime={pr.updated_at}>{formatTimeAgo(new Date(pr.updated_at))}</time>
        <span className="github-review" data-decision={pr.review_decision}>
          {REVIEW_LABELS[pr.review_decision]}
        </span>
        {pr.ci_status !== null && (
          <span className="github-ci" data-status={pr.ci_status}>
            {CI_LABELS[pr.ci_status]}
          </span>
        )}
        <Labels labels={pr.labels} />
      </div>
    </li>
  );
}

function IssueRow({ issue }: { issue: GitHubIssue }): React.JSX.Element {
  return (
    <li className="github-row">
      <div className="github-row-title">
        <a href={issue.url} target="_blank" rel="noreferrer">
          {issue.title}
        </a>
      </div>
      <div className="github-row-meta">
        <span>{`${issue.repository}#${issue.number}`}</span>
        {issue.author !== null && <span>{issue.author}</span>}
        {issue.assignees.length > 0 && <span>{`Assigned to ${issue.assignees.join(", ")}`}</span>}
        <time dateTime={issue.updated_at}>{formatTimeAgo(new Date(issue.updated_at))}</time>
        <span>{issue.comment_count === 1 ? "1 comment" : `${issue.comment_count} comments`}</span>
        <Labels labels={issue.labels} />
      </div>
    </li>
  );
}

/** The GitHub view (#579, #582): open Pull Requests and open GitHub Issues
 * across every Watched Repository, in two tabs. Read from GitHub each time
 * a tab opens, through the backend's one-minute cache that Refresh bypasses
 * (#583); nothing is stored. Each row links out to GitHub, since
 * tuk-tuk never writes there. */
export function GitHubView({ onOpenSettings }: { onOpenSettings: () => void }): React.JSX.Element {
  const [tab, setTab] = useState<GitHubTab>("pull-requests");

  return (
    <div className="github-view">
      <div role="tablist" aria-label="GitHub" className="github-tabs">
        {TABS.map(({ tab: id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`github-tab-${id}`}
            aria-selected={id === tab}
            aria-controls={`github-panel-${id}`}
            className="github-tab"
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`github-panel-${tab}`} aria-labelledby={`github-tab-${tab}`}>
        {tab === "pull-requests" ? (
          <GitHubRead
            key={tab}
            load={fetchGitHubPullRequests}
            onOpenSettings={onOpenSettings}
            render={(read) => <PullRequestGroups items={read.items} />}
          />
        ) : (
          <GitHubRead
            key={tab}
            load={fetchGitHubIssues}
            onOpenSettings={onOpenSettings}
            render={(read) => <IssueList items={read.items} />}
          />
        )}
      </div>
    </div>
  );
}

/** One tab's read: loading, failure and the no-Watched-Repositories state
 * are the same for every tab; `render` draws the items, followed by the
 * links to whatever GitHub holds beyond the per-repository cap. */
function GitHubRead<Item>({
  load,
  onOpenSettings,
  render,
}: {
  load: (options?: GitHubReadOptions) => Promise<GitHubViewRead<Item>>;
  onOpenSettings: () => void;
  render: (read: GitHubViewRead<Item>) => React.ReactNode;
}): React.JSX.Element {
  const [read, setRead] = useState<GitHubViewRead<Item> | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (result) => {
        if (!cancelled) setRead(result);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [load]);

  // Refresh and Retry (#583): read from GitHub now, bypassing the cache,
  // keeping the current read in view until the new one arrives.
  const refresh = (): void => {
    setRefreshing(true);
    load({ refresh: true })
      .then(
        (result) => {
          setRead(result);
          setFailed(false);
        },
        () => setFailed(true),
      )
      .finally(() => setRefreshing(false));
  };

  if (failed) return <p role="alert">GitHub couldn’t be read. Try again in a moment.</p>;
  if (read === null) return <p className="github-loading">Loading…</p>;
  if (read.tokens.length === 0) {
    return (
      <div className="github-empty">
        <p>You aren’t watching any repositories yet.</p>
        <a
          href={pathForSettingsTab("github")}
          onClick={(event) => {
            event.preventDefault();
            onOpenSettings();
          }}
        >
          Pick Watched Repositories
        </a>
      </div>
    );
  }
  return (
    <>
      <GitHubFreshness fetchedAt={read.fetched_at} refreshing={refreshing} onRefresh={refresh} />
      {read.stale && <GitHubStaleNotice fetchedAt={read.fetched_at} onRetry={refresh} />}
      <GitHubTokenBanners tokens={read.tokens} onOpenSettings={onOpenSettings} onRetry={refresh} />
      {render(read)}
      <OverflowLinks repositories={read.repositories} />
    </>
  );
}

function PullRequestGroups({ items }: { items: GitHubPullRequest[] }): React.JSX.Element {
  return (
    <>
      {items.length === 0 && <p className="github-empty">No open Pull Requests.</p>}
      {GROUPS.map(({ relationship, label }) => {
        const grouped = items.filter((pr) => pr.relationship === relationship);
        if (grouped.length === 0) return null;
        return (
          <section key={relationship} aria-label={label} className="github-group">
            <h2>{label}</h2>
            <ul>
              {grouped.map((pr) => (
                <PullRequestRow key={`${pr.repository}#${pr.number}`} pr={pr} />
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

function IssueList({ items }: { items: GitHubIssue[] }): React.JSX.Element {
  if (items.length === 0) return <p className="github-empty">No open GitHub Issues.</p>;
  return (
    <ul className="github-list">
      {items.map((issue) => (
        <IssueRow key={`${issue.repository}#${issue.number}`} issue={issue} />
      ))}
    </ul>
  );
}

function OverflowLinks({
  repositories,
}: {
  repositories: GitHubRepositoryRead[];
}): React.JSX.Element | null {
  const overflowing = repositories.filter((repo) => repo.overflow_count > 0);
  if (overflowing.length === 0) return null;
  return (
    <ul aria-label="More on GitHub" className="github-overflow">
      {overflowing.map((repo) => (
        <li key={repo.watched_repository_id}>
          <span>{repo.full_name}: </span>
          <a href={repo.overflow_url} target="_blank" rel="noreferrer">
            {`${repo.overflow_count} more on GitHub`}
          </a>
        </li>
      ))}
    </ul>
  );
}
