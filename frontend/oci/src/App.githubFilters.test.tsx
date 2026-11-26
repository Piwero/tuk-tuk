import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "./App";
import {
  fakeGitHubIssue,
  fakeGitHubPullRequest,
  fakeGitHubToken,
  installFakeApi,
} from "./test/fakeApi";

/** The GitHub view's filter controls (#585), rendered against the fake API.
 * They narrow what the backend returned, in the browser. */

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

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

async function openGitHub(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<App />);
  const nav = await screen.findByRole("navigation", { name: "GitHub" });
  await user.click(within(nav).getByRole("link", { name: "GitHub" }));
  return user;
}

function shownTitles(): string[] {
  const panel = screen.getByRole("tabpanel");
  return within(panel)
    .queryAllByRole("listitem")
    .map((row) => within(row).getAllByRole("link")[0]?.textContent ?? "");
}

function optionsOf(select: HTMLElement): string[] {
  return within(select)
    .getAllByRole("option")
    .map((option) => option.textContent ?? "");
}

describe("GitHub view › filters", () => {
  it("narrows Pull Requests to one author, chosen from the authors present", async () => {
    installFakeApi({
      ...watchedDotfiles(),
      githubPullRequests: [
        fakeGitHubPullRequest(3, "Parser", { author: "monalisa" }),
        fakeGitHubPullRequest(2, "Refactor", { author: "octocat" }),
        fakeGitHubPullRequest(1, "Fix", { author: "monalisa" }),
      ],
    });
    const user = await openGitHub();
    await screen.findByRole("link", { name: "Parser" });

    const author = screen.getByRole("combobox", { name: "Author" });
    expect(optionsOf(author)).toEqual(["Anyone", "monalisa", "octocat"]);
    await user.selectOptions(author, "monalisa");

    expect(shownTitles()).toEqual(["Parser", "Fix"]);
  });

  it("narrows GitHub Issues to one label, chosen from the labels present", async () => {
    const bug = { name: "bug", color: "d73a4a" };
    const ready = { name: "ready-for-agent", color: "0e8a16" };
    installFakeApi({
      ...watchedDotfiles(),
      githubIssues: [
        fakeGitHubIssue(3, "Slow prompt", { labels: [bug, ready] }),
        fakeGitHubIssue(2, "Crash", { labels: [bug] }),
        fakeGitHubIssue(1, "Docs", { labels: [] }),
      ],
    });
    const user = await openGitHub();
    await user.click(await screen.findByRole("tab", { name: "Issues" }));
    await screen.findByRole("link", { name: "Slow prompt" });

    const label = screen.getByRole("combobox", { name: "Label" });
    expect(optionsOf(label)).toEqual(["Any label", "bug", "ready-for-agent"]);
    await user.selectOptions(label, "ready-for-agent");

    expect(shownTitles()).toEqual(["Slow prompt"]);
  });

  it("narrows GitHub Issues to one assignee, an option the Pull Requests tab lacks", async () => {
    installFakeApi({
      ...watchedDotfiles(),
      githubPullRequests: [fakeGitHubPullRequest(9, "Parser")],
      githubIssues: [
        fakeGitHubIssue(3, "Slow prompt", { assignees: ["octocat", "monalisa"] }),
        fakeGitHubIssue(2, "Crash", { assignees: ["monalisa"] }),
        fakeGitHubIssue(1, "Docs", { assignees: [] }),
      ],
    });
    const user = await openGitHub();
    await screen.findByRole("link", { name: "Parser" });
    expect(screen.queryByRole("combobox", { name: "Assignee" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Issues" }));
    await screen.findByRole("link", { name: "Slow prompt" });
    const assignee = screen.getByRole("combobox", { name: "Assignee" });
    expect(optionsOf(assignee)).toEqual(["Anyone", "monalisa", "octocat"]);
    await user.selectOptions(assignee, "octocat");

    expect(shownTitles()).toEqual(["Slow prompt"]);
  });

  it("hides draft Pull Requests", async () => {
    installFakeApi({
      ...watchedDotfiles(),
      githubPullRequests: [
        fakeGitHubPullRequest(2, "Work in progress", { is_draft: true }),
        fakeGitHubPullRequest(1, "Ready", { is_draft: false }),
      ],
    });
    const user = await openGitHub();
    await screen.findByRole("link", { name: "Ready" });

    await user.click(screen.getByRole("checkbox", { name: "Hide drafts" }));

    expect(shownTitles()).toEqual(["Ready"]);
  });

  it("hides items whose author is a bot, on both tabs", async () => {
    installFakeApi({
      ...watchedDotfiles(),
      githubPullRequests: [
        fakeGitHubPullRequest(2, "Bump lodash", {
          author: "dependabot[bot]",
          author_is_bot: true,
        }),
        fakeGitHubPullRequest(1, "Human fix", { author: "octocat" }),
      ],
      githubIssues: [
        fakeGitHubIssue(4, "Dependency dashboard", { author: "renovate", author_is_bot: true }),
        fakeGitHubIssue(3, "Human report", { author: "monalisa" }),
      ],
    });
    const user = await openGitHub();
    await screen.findByRole("link", { name: "Human fix" });

    await user.click(screen.getByRole("checkbox", { name: "Hide bots" }));
    expect(shownTitles()).toEqual(["Human fix"]);

    await user.click(screen.getByRole("tab", { name: "Issues" }));
    await screen.findByRole("link", { name: "Human report" });
    expect(screen.getByRole("checkbox", { name: "Hide bots" })).toBeChecked();
    expect(screen.queryByRole("checkbox", { name: "Hide drafts" })).not.toBeInTheDocument();
    expect(shownTitles()).toEqual(["Human report"]);
  });

  it("filters without asking the backend, and so GitHub, again", async () => {
    const api = installFakeApi({
      ...watchedDotfiles(),
      githubPullRequests: [
        fakeGitHubPullRequest(2, "Parser", { author: "monalisa", is_draft: true }),
        fakeGitHubPullRequest(1, "Fix", { author: "octocat" }),
      ],
    });
    const user = await openGitHub();
    await screen.findByRole("link", { name: "Parser" });
    const reads = (): string[] =>
      api.requests.filter((r) => r.url.startsWith("/api/v1/github/")).map((r) => r.url);
    const before = reads();

    await user.selectOptions(screen.getByRole("combobox", { name: "Author" }), "octocat");
    await user.click(screen.getByRole("checkbox", { name: "Hide drafts" }));
    await user.click(screen.getByRole("checkbox", { name: "Hide bots" }));

    expect(shownTitles()).toEqual(["Fix"]);
    expect(reads()).toEqual(before);
  });

  it("keeps the groups in order with their filtered counts, and says when one is emptied", async () => {
    installFakeApi({
      ...watchedDotfiles(),
      githubPullRequests: [
        fakeGitHubPullRequest(4, "Review my parser", {
          relationship: "review_requested",
          author: "monalisa",
        }),
        fakeGitHubPullRequest(3, "My refactor", { relationship: "mine", author: "octocat" }),
        fakeGitHubPullRequest(2, "Their fix", { relationship: "other", author: "monalisa" }),
        fakeGitHubPullRequest(1, "Their docs", { relationship: "other", author: "hubot" }),
      ],
    });
    const user = await openGitHub();
    await screen.findByRole("link", { name: "Review my parser" });
    const groups = (): string[][] =>
      screen.getAllByRole("region", { name: /Review requested|Mine|Others/ }).map((group) => [
        within(group).getByRole("heading").textContent ?? "",
        ...within(group)
          .queryAllByRole("link")
          .map((link) => link.textContent ?? ""),
        ...within(group)
          .queryAllByRole("status")
          .map((note) => note.textContent ?? ""),
      ]);
    expect(groups()).toEqual([
      ["Review requested 1", "Review my parser"],
      ["Mine 1", "My refactor"],
      ["Others 2", "Their fix", "Their docs"],
    ]);

    await user.selectOptions(screen.getByRole("combobox", { name: "Author" }), "monalisa");

    expect(groups()).toEqual([
      ["Review requested 1", "Review my parser"],
      ["Mine 0", "No Pull Requests here match the filters."],
      ["Others 1", "Their fix"],
    ]);
  });

  it("forgets the filters when the User leaves the view and comes back", async () => {
    installFakeApi({
      ...watchedDotfiles(),
      githubPullRequests: [
        fakeGitHubPullRequest(2, "Parser", { author: "monalisa", is_draft: true }),
        fakeGitHubPullRequest(1, "Fix", { author: "octocat" }),
      ],
    });
    const user = await openGitHub();
    await screen.findByRole("link", { name: "Parser" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Author" }), "octocat");
    await user.click(screen.getByRole("checkbox", { name: "Hide drafts" }));
    expect(shownTitles()).toEqual(["Fix"]);

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(await screen.findByRole("menuitem", { name: "My account" }));
    await waitFor(() => expect(screen.queryByRole("tablist", { name: "GitHub" })).toBeNull());
    const nav = screen.getByRole("navigation", { name: "GitHub" });
    await user.click(within(nav).getByRole("link", { name: "GitHub" }));

    await screen.findByRole("link", { name: "Parser" });
    expect(screen.getByRole("combobox", { name: "Author" })).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: "Hide drafts" })).not.toBeChecked();
    expect(shownTitles()).toEqual(["Parser", "Fix"]);
  });

  it("says no GitHub Issues match when the filters leave none", async () => {
    installFakeApi({
      ...watchedDotfiles(),
      githubIssues: [fakeGitHubIssue(2, "Bot report", { author: "renovate", author_is_bot: true })],
    });
    const user = await openGitHub();
    await user.click(await screen.findByRole("tab", { name: "Issues" }));
    await screen.findByRole("link", { name: "Bot report" });

    await user.click(screen.getByRole("checkbox", { name: "Hide bots" }));

    expect(screen.getByText("No GitHub Issues match the filters.")).toBeInTheDocument();
    expect(screen.queryByText("No open GitHub Issues.")).not.toBeInTheDocument();
  });
});
