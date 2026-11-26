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
    .map((row) => within(row).getAllByRole("link")[0].textContent ?? "");
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
});
