import "./GitHubView.css";

import { useEffect, useState } from "react";

import {
  fetchGitHubPullRequests,
  type GitHubPullRequest,
  type GitHubPullRequestsRead,
  type PullRequestRelationship,
} from "../api";
import { formatTimeAgo } from "../dates";
import { pathForSettingsTab } from "../routes";

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
        {pr.labels.map((label) => (
          <span key={label.name} className="github-label" style={labelStyle(label.color)}>
            {label.name}
          </span>
        ))}
      </div>
    </li>
  );
}

/** The GitHub view (#579): open Pull Requests across every Watched
 * Repository, grouped by the User's relationship to them. Read live from
 * GitHub on every load; nothing is stored. Each row links out to GitHub,
 * since tuk-tuk never writes there. */
export function GitHubView({ onOpenSettings }: { onOpenSettings: () => void }): React.JSX.Element {
  const [read, setRead] = useState<GitHubPullRequestsRead | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchGitHubPullRequests().then(
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
  }, []);

  return (
    <div className="github-view">
      <div role="tablist" aria-label="GitHub" className="github-tabs">
        <button type="button" role="tab" aria-selected="true" className="github-tab">
          Pull Requests
        </button>
      </div>
      <div role="tabpanel" aria-label="Pull Requests">
        {failed ? (
          <p role="alert">GitHub couldn’t be read. Try again in a moment.</p>
        ) : read === null ? (
          <p className="github-loading">Loading…</p>
        ) : read.tokens.length === 0 ? (
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
        ) : (
          <PullRequestGroups read={read} />
        )}
      </div>
    </div>
  );
}

function PullRequestGroups({ read }: { read: GitHubPullRequestsRead }): React.JSX.Element {
  const overflowing = read.repositories.filter((repo) => repo.overflow_count > 0);
  return (
    <>
      {read.items.length === 0 && <p className="github-empty">No open Pull Requests.</p>}
      {GROUPS.map(({ relationship, label }) => {
        const items = read.items.filter((pr) => pr.relationship === relationship);
        if (items.length === 0) return null;
        return (
          <section key={relationship} aria-label={label} className="github-group">
            <h2>{label}</h2>
            <ul>
              {items.map((pr) => (
                <PullRequestRow key={`${pr.repository}#${pr.number}`} pr={pr} />
              ))}
            </ul>
          </section>
        );
      })}
      {overflowing.length > 0 && (
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
      )}
    </>
  );
}
