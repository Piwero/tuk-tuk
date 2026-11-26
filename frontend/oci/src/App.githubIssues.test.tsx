import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "./App";
import {
  fakeGitHubIssue,
  fakeGitHubPullRequest,
  fakeGitHubToken,
  installFakeApi,
} from "./test/fakeApi";

/** The GitHub view's GitHub Issues tab (#582), rendered against the fake
 * API. The backend sorts; the fake returns its answer as is. */

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

const HOUR = 60 * 60 * 1000;

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * HOUR).toISOString();
}

/** One watched repository, octocat/dotfiles, read through octocat's token. */
function watchedDotfiles(): {
  githubTokens: ReturnType<typeof fakeGitHubToken>[];
  watchedRepositories: { github_token_id: number; github_repo_id: number; full_name: string }[];
} {
  const token = fakeGitHubToken("octocat");
  return {
    githubTokens: [token],
    watchedRepositories: [
      { github_token_id: token.id, github_repo_id: 1, full_name: "octocat/dotfiles" },
    ],
  };
}

async function openIssuesTab(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<App />);
  const nav = await screen.findByRole("navigation", { name: "GitHub" });
  await user.click(within(nav).getByRole("link", { name: "GitHub" }));
  await user.click(await screen.findByRole("tab", { name: "Issues" }));
  return user;
}

describe("GitHub view › Issues", () => {
  it("switches to the Issues tab without leaving the GitHub view", async () => {
    const api = installFakeApi({
      ...watchedDotfiles(),
      githubIssues: [fakeGitHubIssue(12, "Zsh prompt is slow")],
    });

    await openIssuesTab();

    expect(window.location.pathname).toBe("/github");
    expect(screen.getByRole("tab", { name: "Issues" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Pull Requests" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    const panel = screen.getByRole("tabpanel", { name: "Issues" });
    expect(await within(panel).findByRole("link", { name: "Zsh prompt is slow" })).toBeVisible();
    expect(api.requests.some((r) => r.method === "GET" && r.url === "/api/v1/github/issues")).toBe(
      true,
    );
  });

  it("switches back to the Pull Requests tab", async () => {
    installFakeApi({
      ...watchedDotfiles(),
      githubPullRequests: [fakeGitHubPullRequest(7, "Add zsh config")],
      githubIssues: [fakeGitHubIssue(12, "Zsh prompt is slow")],
    });
    const user = await openIssuesTab();
    await screen.findByRole("link", { name: "Zsh prompt is slow" });

    await user.click(screen.getByRole("tab", { name: "Pull Requests" }));

    expect(await screen.findByRole("link", { name: "Add zsh config" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Zsh prompt is slow" })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/github");
  });

  it("lists GitHub Issues in the backend's order, most recently updated first", async () => {
    installFakeApi({
      ...watchedDotfiles(),
      githubIssues: [
        fakeGitHubIssue(3, "Newest", { updated_at: hoursAgo(1) }),
        fakeGitHubIssue(1, "Older", { updated_at: hoursAgo(5) }),
      ],
    });

    await openIssuesTab();

    const panel = screen.getByRole("tabpanel", { name: "Issues" });
    await within(panel).findByRole("link", { name: "Newest" });
    expect(
      within(panel)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Newest", "Older"]);
  });

  it("shows each GitHub Issue's details and links it to GitHub", async () => {
    installFakeApi({
      ...watchedDotfiles(),
      githubIssues: [
        fakeGitHubIssue(12, "Zsh prompt is slow", {
          author: "hubot",
          assignees: ["octocat", "monalisa"],
          labels: [{ name: "bug", color: "d73a4a" }],
          // Its age is the time since it was opened (spec #576).
          created_at: hoursAgo(3),
          updated_at: hoursAgo(1),
          comment_count: 4,
        }),
      ],
    });

    await openIssuesTab();

    const link = await screen.findByRole("link", { name: "Zsh prompt is slow" });
    expect(link).toHaveAttribute("href", "https://github.com/octocat/dotfiles/issues/12");
    const row = within(link.closest("li") as HTMLElement);
    expect(row.getByText("octocat/dotfiles#12")).toBeInTheDocument();
    expect(row.getByText("hubot")).toBeInTheDocument();
    expect(row.getByText("Assigned to octocat, monalisa")).toBeInTheDocument();
    expect(row.getByText("bug")).toBeInTheDocument();
    expect(row.getByText("3 hours ago")).toBeInTheDocument();
    expect(row.queryByText("1 hour ago")).not.toBeInTheDocument();
    expect(row.getByText("4 comments")).toBeInTheDocument();
  });

  it("names a single comment and leaves out an unassigned GitHub Issue's assignees", async () => {
    installFakeApi({
      ...watchedDotfiles(),
      githubIssues: [fakeGitHubIssue(1, "Lonely", { assignees: [], comment_count: 1 })],
    });

    await openIssuesTab();

    const row = within(
      (await screen.findByRole("link", { name: "Lonely" })).closest("li") as HTMLElement,
    );
    expect(row.getByText("1 comment")).toBeInTheDocument();
    expect(row.queryByText(/Assigned to/)).not.toBeInTheDocument();
  });

  it("links a repository with more than 100 open GitHub Issues to the rest on GitHub", async () => {
    installFakeApi({
      ...watchedDotfiles(),
      githubIssues: [fakeGitHubIssue(1, "One of many")],
      githubIssueOverflow: { "octocat/dotfiles": 40 },
    });

    await openIssuesTab();

    const more = await screen.findByRole("link", { name: "40 more on GitHub" });
    expect(more).toHaveAttribute("href", "https://github.com/octocat/dotfiles/issues");
  });

  it("says so when no Watched Repository has an open GitHub Issue", async () => {
    installFakeApi(watchedDotfiles());

    await openIssuesTab();

    expect(await screen.findByText("No open GitHub Issues.")).toBeInTheDocument();
  });
});
