import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "./App";
import {
  fakeGitHubIssue,
  fakeGitHubPullRequest,
  fakeGitHubToken,
  fakeRepositoryView,
  installFakeApi,
} from "./test/fakeApi";

/** Repository Views (#580), rendered against the fake API: named subsets
 * of the Watched Repositories under GitHub in the sidebar, each opening as
 * it was left. */

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

const DOTFILES = 11;
const BLOG = 12;
const API = 13;

/** octocat/dotfiles, octocat/blog and acme/api, each with one open Pull
 * Request and one open GitHub Issue named after it. */
function threeWatched(): Parameters<typeof installFakeApi>[0] {
  const octocat = fakeGitHubToken("octocat");
  const acme = fakeGitHubToken("acme");
  const repos = [
    { id: DOTFILES, token: octocat, name: "octocat/dotfiles" },
    { id: BLOG, token: octocat, name: "octocat/blog" },
    { id: API, token: acme, name: "acme/api" },
  ];
  return {
    githubTokens: [octocat, acme],
    watchedRepositories: repos.map(({ id, token, name }) => ({
      id,
      github_token_id: token.id,
      github_repo_id: id,
      full_name: name,
    })),
    githubPullRequests: repos.map(({ name }) =>
      fakeGitHubPullRequest(1, `${name} PR`, { repository: name }),
    ),
    githubIssues: repos.map(({ name }) =>
      fakeGitHubIssue(2, `${name} issue`, { repository: name }),
    ),
  };
}

function repositoryViewsNav(): HTMLElement {
  return within(screen.getByRole("navigation", { name: "GitHub" })).getByRole("list", {
    name: "Repository Views",
  });
}

function shownTitles(): string[] {
  const panel = screen.getByRole("tabpanel");
  return within(panel)
    .queryAllByRole("listitem")
    .map((row) => within(row).getAllByRole("link")[0]?.textContent ?? "");
}

describe("Repository Views", () => {
  it("are listed under GitHub in their saved order, each opening at its own path with its repositories only", async () => {
    const api = installFakeApi({
      ...threeWatched(),
      repositoryViews: [
        fakeRepositoryView("Side projects", [BLOG], { sort_order: 2048 }),
        fakeRepositoryView("Work", [API], { sort_order: 1024 }),
      ],
    });
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() =>
      expect(
        within(repositoryViewsNav())
          .getAllByRole("link")
          .map((link) => link.textContent),
      ).toEqual(["Work", "Side projects"]),
    );
    await user.click(within(repositoryViewsNav()).getByRole("link", { name: "Side projects" }));

    await screen.findByRole("link", { name: "octocat/blog PR" });
    expect(shownTitles()).toEqual(["octocat/blog PR"]);
    const side = api.repositoryViews.find((v) => v.name === "Side projects");
    expect(window.location.pathname).toBe(`/github/views/${side?.id}`);
    expect(
      within(repositoryViewsNav()).getByRole("link", { name: "Side projects" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("are made with New view: named in the sidebar, then given repositories", async () => {
    const api = installFakeApi(threeWatched());
    const user = userEvent.setup();
    render(<App />);

    const nav = await screen.findByRole("navigation", { name: "GitHub" });
    await user.click(within(nav).getByRole("button", { name: "New view" }));
    await user.type(within(nav).getByRole("textbox", { name: "View name" }), "Work");
    await user.click(within(nav).getByRole("button", { name: "Create" }));

    expect(await screen.findByText("This view has no repositories.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit view" }));
    await user.click(await screen.findByRole("checkbox", { name: "acme/api" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByRole("link", { name: "acme/api PR" });
    expect(shownTitles()).toEqual(["acme/api PR"]);
    expect(api.repositoryViews.map((v) => [v.name, v.watched_repository_ids])).toEqual([
      ["Work", [API]],
    ]);
    expect(within(repositoryViewsNav()).getByRole("link", { name: "Work" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("opens with the filters and tab it was left with, and saves every change to them", async () => {
    const work = fakeRepositoryView("Work", [DOTFILES, API], {
      author: "monalisa",
      active_tab: "issues",
    });
    const api = installFakeApi({
      ...threeWatched(),
      githubIssues: [
        fakeGitHubIssue(3, "Crash", { author: "monalisa", repository: "acme/api" }),
        fakeGitHubIssue(2, "Docs", { author: "octocat", repository: "acme/api" }),
        fakeGitHubIssue(1, "Typo", { author: "monalisa", repository: "octocat/dotfiles" }),
      ],
      repositoryViews: [work],
    });
    window.history.replaceState(null, "", `/github/views/${work.id}`);
    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("link", { name: "Crash" });
    expect(screen.getByRole("tab", { name: "GitHub Issues" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("combobox", { name: "Author" })).toHaveValue("monalisa");
    expect(shownTitles()).toEqual(["Crash", "Typo"]);

    await user.click(screen.getByRole("checkbox", { name: "Hide bots" }));
    await user.click(screen.getByRole("tab", { name: "Pull Requests" }));

    await waitFor(() =>
      expect(api.repositoryViews[0]).toMatchObject({
        author: "monalisa",
        hide_bots: true,
        active_tab: "pull_requests",
      }),
    );
  });

  it("refreshes its own repositories from GitHub with Refresh", async () => {
    const work = fakeRepositoryView("Work", [API]);
    const api = installFakeApi({ ...threeWatched(), repositoryViews: [work] });
    window.history.replaceState(null, "", `/github/views/${work.id}`);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("link", { name: "acme/api PR" });

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() =>
      expect(
        api.requests.some(
          (r) =>
            r.method === "GET" &&
            r.url === `/api/v1/github/pull-requests?view=${work.id}&refresh=true`,
        ),
      ).toBe(true),
    );
    expect(shownTitles()).toEqual(["acme/api PR"]);
  });

  it("keeps showing a saved filter that nothing open matches any more", async () => {
    const work = fakeRepositoryView("Work", [API], { author: "ghost" });
    installFakeApi({ ...threeWatched(), repositoryViews: [work] });
    window.history.replaceState(null, "", `/github/views/${work.id}`);
    render(<App />);

    expect(await screen.findByRole("combobox", { name: "Author" })).toHaveValue("ghost");
    expect(shownTitles()).toEqual([]);
  });

  it("clears its saved filters and tab with Reset", async () => {
    const work = fakeRepositoryView("Work", [DOTFILES, API], {
      author: "monalisa",
      hide_drafts: true,
      active_tab: "issues",
    });
    const api = installFakeApi({ ...threeWatched(), repositoryViews: [work] });
    window.history.replaceState(null, "", `/github/views/${work.id}`);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Reset" }));

    await screen.findByRole("link", { name: "octocat/dotfiles PR" });
    expect(shownTitles()).toEqual(["octocat/dotfiles PR", "acme/api PR"]);
    expect(screen.getByRole("combobox", { name: "Author" })).toHaveValue("");
    expect(api.repositoryViews[0]).toMatchObject({
      author: null,
      label: null,
      assignee: null,
      hide_drafts: false,
      hide_bots: false,
      active_tab: "pull_requests",
    });
    expect(screen.queryByRole("button", { name: "Reset" })).not.toBeInTheDocument();
  });

  it("never saves the filters of the default view over every Watched Repository", async () => {
    const api = installFakeApi({
      ...threeWatched(),
      repositoryViews: [fakeRepositoryView("Work", [API])],
    });
    const user = userEvent.setup();
    render(<App />);
    const nav = await screen.findByRole("navigation", { name: "GitHub" });
    await user.click(within(nav).getByRole("link", { name: "GitHub" }));
    await screen.findByRole("link", { name: "acme/api PR" });

    await user.click(screen.getByRole("checkbox", { name: "Hide bots" }));
    await user.click(screen.getByRole("tab", { name: "GitHub Issues" }));

    expect(api.requests.filter((r) => r.url.startsWith("/api/v1/github/views/"))).toEqual([]);
    expect(screen.queryByRole("button", { name: "Reset" })).not.toBeInTheDocument();
  });

  it("left with no repositories stays, with an empty state that links to Settings", async () => {
    const empty = fakeRepositoryView("Old work", []);
    installFakeApi({ ...threeWatched(), repositoryViews: [empty] });
    window.history.replaceState(null, "", `/github/views/${empty.id}`);
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("This view has no repositories.")).toBeInTheDocument();
    expect(within(repositoryViewsNav()).getByRole("link", { name: "Old work" })).toBeVisible();
    // One calm sentence plus the primary action (design system).
    expect(screen.queryByRole("button", { name: "Choose repositories" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Pick Watched Repositories in Settings" }));

    expect(window.location.pathname).toBe("/settings/github");
  });

  it("drops a repository unwatched in Settings", async () => {
    const work = fakeRepositoryView("Work", [API]);
    installFakeApi({
      ...threeWatched(),
      githubReadableRepositories: { acme: [{ github_repo_id: API, full_name: "acme/api" }] },
      repositoryViews: [work],
    });
    window.history.replaceState(null, "", `/github/views/${work.id}`);
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("link", { name: "acme/api PR" });

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("menuitem", { name: "My account" }));
    const tabs = await screen.findByRole("navigation", { name: "Settings" });
    await user.click(within(tabs).getByRole("link", { name: "GitHub" }));
    const box = await screen.findByRole("checkbox", { name: "acme/api" });
    await waitFor(() => expect(box).toBeChecked());
    await user.click(box);
    await waitFor(() => expect(box).not.toBeChecked());
    await user.click(within(repositoryViewsNav()).getByRole("link", { name: "Work" }));

    expect(await screen.findByText("This view has no repositories.")).toBeInTheDocument();
  });

  it("can be renamed, moved in the sidebar and deleted", async () => {
    const work = fakeRepositoryView("Work", [API]);
    const side = fakeRepositoryView("Side", [BLOG]);
    const api = installFakeApi({ ...threeWatched(), repositoryViews: [work, side] });
    window.history.replaceState(null, "", `/github/views/${side.id}`);
    const user = userEvent.setup();
    render(<App />);
    const sidebarNames = (): (string | null)[] =>
      within(repositoryViewsNav())
        .getAllByRole("link")
        .map((link) => link.textContent);

    await user.click(await screen.findByRole("button", { name: "Edit view" }));
    const name = screen.getByRole("textbox", { name: "View name" });
    await user.clear(name);
    await user.type(name, "Side projects");
    await user.click(screen.getByRole("button", { name: "Move up" }));
    await waitFor(() => expect(sidebarNames()).toEqual(["Side", "Work"]));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sidebarNames()).toEqual(["Side projects", "Work"]));

    await user.click(screen.getByRole("button", { name: "Edit view" }));
    await user.click(screen.getByRole("button", { name: "Delete view" }));

    await waitFor(() => expect(sidebarNames()).toEqual(["Work"]));
    expect(api.repositoryViews.map((v) => v.name)).toEqual(["Work"]);
    expect(window.location.pathname).toBe("/github");
  });
});
