import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "./App";
import { fakeGitHubPullRequest, fakeGitHubToken, installFakeApi } from "./test/fakeApi";

/** The GitHub view's Pull Requests tab (#579), rendered against the fake
 * API. The backend groups and sorts; the fake returns its answer as is. */

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

const HOUR = 60 * 60 * 1000;

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * HOUR).toISOString();
}

async function openGitHub(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<App />);
  const nav = await screen.findByRole("navigation", { name: "GitHub" });
  await user.click(within(nav).getByRole("link", { name: "GitHub" }));
  return user;
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

describe("GitHub view › Pull Requests", () => {
  it("opens from the sidebar at its own route, on the Pull Requests tab", async () => {
    const api = installFakeApi(watchedDotfiles());

    await openGitHub();

    expect(window.location.pathname).toBe("/github");
    expect(await screen.findByRole("tab", { name: "Pull Requests" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      api.requests.some((r) => r.method === "GET" && r.url === "/api/v1/github/pull-requests"),
    ).toBe(true);
  });

  it("opens straight from its URL", async () => {
    installFakeApi(watchedDotfiles());
    window.history.replaceState(null, "", "/github");

    render(<App />);

    expect(await screen.findByRole("tab", { name: "Pull Requests" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "GitHub" })).toBeInTheDocument();
  });

  it("groups Pull Requests as Review requested, then Mine, then Others", async () => {
    installFakeApi({
      ...watchedDotfiles(),
      githubPullRequests: [
        fakeGitHubPullRequest(3, "Review my parser", { relationship: "review_requested" }),
        fakeGitHubPullRequest(2, "My refactor", { relationship: "mine", author: "octocat" }),
        fakeGitHubPullRequest(1, "Their fix", { relationship: "other" }),
        fakeGitHubPullRequest(4, "Their older fix", { relationship: "other" }),
      ],
    });

    await openGitHub();

    const groups = await screen.findAllByRole("region", { name: /Review requested|Mine|Others/ });
    expect(
      groups.map((group) => [
        group.getAttribute("aria-label"),
        within(group)
          .getAllByRole("link")
          .map((link) => link.textContent),
      ]),
    ).toEqual([
      ["Review requested", ["Review my parser"]],
      ["Mine", ["My refactor"]],
      ["Others", ["Their fix", "Their older fix"]],
    ]);
  });

  it("shows each Pull Request's details and links it to GitHub", async () => {
    installFakeApi({
      ...watchedDotfiles(),
      githubPullRequests: [
        fakeGitHubPullRequest(7, "Add zsh config", {
          author: "hubot",
          updated_at: hoursAgo(3),
          labels: [{ name: "enhancement", color: "a2eeef" }],
          is_draft: true,
          review_decision: "changes_requested",
          ci_status: "fail",
        }),
      ],
    });

    await openGitHub();

    const link = await screen.findByRole("link", { name: "Add zsh config" });
    expect(link).toHaveAttribute("href", "https://github.com/octocat/dotfiles/pull/7");
    const row = link.closest("li");
    expect(row).not.toBeNull();
    const details = within(row as HTMLElement);
    expect(details.getByText("octocat/dotfiles#7")).toBeInTheDocument();
    expect(details.getByText("hubot")).toBeInTheDocument();
    expect(details.getByText("3 hours ago")).toBeInTheDocument();
    expect(details.getByText("enhancement")).toBeInTheDocument();
    expect(details.getByText("Draft")).toBeInTheDocument();
    expect(details.getByText("Changes requested")).toBeInTheDocument();
    expect(details.getByText("CI failing")).toBeInTheDocument();
  });

  it.each([
    ["approved", "pass", "Approved", "CI passing"],
    ["pending", "pending", "Review pending", "CI pending"],
  ] as const)(
    "names a %s review decision and %s CI",
    async (reviewDecision, ciStatus, reviewText, ciText) => {
      installFakeApi({
        ...watchedDotfiles(),
        githubPullRequests: [
          fakeGitHubPullRequest(1, "Something", {
            review_decision: reviewDecision,
            ci_status: ciStatus,
          }),
        ],
      });

      await openGitHub();

      const row = (await screen.findByRole("link", { name: "Something" })).closest("li");
      expect(within(row as HTMLElement).getByText(reviewText)).toBeInTheDocument();
      expect(within(row as HTMLElement).getByText(ciText)).toBeInTheDocument();
      expect(within(row as HTMLElement).queryByText("Draft")).not.toBeInTheDocument();
    },
  );

  it("links a repository with more than 100 open Pull Requests to the rest on GitHub", async () => {
    installFakeApi({
      ...watchedDotfiles(),
      githubPullRequests: [fakeGitHubPullRequest(1, "One of many")],
      githubPullRequestOverflow: { "octocat/dotfiles": 12 },
    });

    await openGitHub();

    const more = await screen.findByRole("link", { name: "12 more on GitHub" });
    expect(more).toHaveAttribute("href", "https://github.com/octocat/dotfiles/pulls");
  });

  it("with no Watched Repositories, links to Settings to pick some", async () => {
    installFakeApi({ githubTokens: [fakeGitHubToken("octocat")] });
    const user = await openGitHub();

    await user.click(await screen.findByRole("link", { name: "Pick Watched Repositories" }));

    expect(window.location.pathname).toBe("/settings/github");
  });
});
