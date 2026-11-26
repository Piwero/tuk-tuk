import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import {
  fakeGitHubIssue,
  fakeGitHubPullRequest,
  fakeGitHubToken,
  installFakeApi,
} from "./test/fakeApi";

/** How fresh the GitHub view is (#583): the age of its data, Refresh, and
 * the stale notice with Retry, rendered against the fake API. The backend
 * caches and falls back to stale results; the fake reports what it would. */

const NOW = new Date("2026-11-26T12:00:00Z");

beforeEach(() => {
  // "fetched N s ago" depends on now: pinned so it never drifts.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

function secondsAgo(seconds: number): string {
  return new Date(NOW.getTime() - seconds * 1000).toISOString();
}

async function openGitHub(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<App />);
  const nav = await screen.findByRole("navigation", { name: "GitHub" });
  await user.click(within(nav).getByRole("link", { name: "GitHub" }));
  return user;
}

/** octocat/dotfiles, read through octocat's token. */
function watchedDotfiles(): Parameters<typeof installFakeApi>[0] {
  const token = fakeGitHubToken("octocat");
  return {
    githubTokens: [token],
    watchedRepositories: [
      { github_token_id: token.id, github_repo_id: 1, full_name: "octocat/dotfiles" },
    ],
  };
}

describe("GitHub view › freshness", () => {
  it("shows how long ago its data was fetched from GitHub", async () => {
    installFakeApi({
      ...watchedDotfiles(),
      githubFetchedAt: secondsAgo(42),
      githubPullRequests: [fakeGitHubPullRequest(1, "Add zsh config")],
    });

    await openGitHub();

    expect(await screen.findByText("fetched 42 s ago")).toBeInTheDocument();
  });

  it("Refresh reads from GitHub now, bypassing the cache", async () => {
    const api = installFakeApi({
      ...watchedDotfiles(),
      githubFetchedAt: secondsAgo(42),
      githubPullRequests: [fakeGitHubPullRequest(1, "Add zsh config")],
    });
    const user = await openGitHub();
    await screen.findByRole("link", { name: "Add zsh config" });
    api.githubPullRequests = [fakeGitHubPullRequest(2, "Opened a moment ago")];
    api.githubFetchedAt = null;

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByRole("link", { name: "Opened a moment ago" })).toBeInTheDocument();
    expect(screen.getByText("fetched 0 s ago")).toBeInTheDocument();
    expect(
      api.requests.some(
        (r) => r.method === "GET" && r.url === "/api/v1/github/pull-requests?refresh=true",
      ),
    ).toBe(true);
  });

  it("Refresh on the Issues tab reads GitHub Issues from GitHub now", async () => {
    const api = installFakeApi({
      ...watchedDotfiles(),
      githubIssues: [fakeGitHubIssue(1, "Old issue")],
    });
    const user = await openGitHub();
    await user.click(await screen.findByRole("tab", { name: "Issues" }));
    await screen.findByRole("link", { name: "Old issue" });
    api.githubIssues = [fakeGitHubIssue(2, "New issue")];

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByRole("link", { name: "New issue" })).toBeInTheDocument();
    expect(
      api.requests.some(
        (r) => r.method === "GET" && r.url === "/api/v1/github/issues?refresh=true",
      ),
    ).toBe(true);
  });
});
