import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "./App";
import { fakeGitHubToken, installFakeApi } from "./test/fakeApi";

/** Settings › GitHub (#581): the Watched Repositories picker, rendered
 * against the fake API. */

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

async function openGitHubSettings(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "Account menu" }));
  await user.click(screen.getByRole("menuitem", { name: "My account" }));
  const tabs = await screen.findByRole("navigation", { name: "Settings" });
  await user.click(within(tabs).getByRole("link", { name: "GitHub" }));
  return user;
}

/** Each repository the picker offers as [owner/name, watched]. */
function offered(): [string, boolean][] {
  const list = screen.queryByRole("list", { name: "Repositories" });
  if (list === null) {
    return [];
  }
  return within(list)
    .getAllByRole("checkbox")
    .map((box) => [box.getAttribute("aria-label") ?? "", (box as HTMLInputElement).checked]);
}

describe("Settings › GitHub › Watched Repositories", () => {
  it("offers every repository the tokens can read once, marking the watched ones", async () => {
    const personal = fakeGitHubToken("octocat");
    const work = fakeGitHubToken("acme", { owner_kind: "organization" });
    installFakeApi({
      githubTokens: [personal, work],
      githubReadableRepositories: {
        octocat: [
          { github_repo_id: 1, full_name: "octocat/dotfiles" },
          { github_repo_id: 2, full_name: "acme/api" },
        ],
        acme: [
          { github_repo_id: 2, full_name: "acme/api" },
          { github_repo_id: 3, full_name: "acme/web" },
        ],
      },
      watchedRepositories: [{ github_token_id: work.id, github_repo_id: 3, full_name: "acme/web" }],
    });

    await openGitHubSettings();

    await screen.findByRole("list", { name: "Repositories" });
    expect(offered()).toEqual([
      ["acme/api", false],
      ["acme/web", true],
      ["octocat/dotfiles", false],
    ]);
  });

  it("narrows the repositories by owner/name as the User types", async () => {
    installFakeApi({
      githubTokens: [fakeGitHubToken("acme", { owner_kind: "organization" })],
      githubReadableRepositories: {
        acme: [
          { github_repo_id: 2, full_name: "acme/api" },
          { github_repo_id: 3, full_name: "acme/web" },
          { github_repo_id: 4, full_name: "acme/web-admin" },
        ],
      },
    });
    const user = await openGitHubSettings();
    await screen.findByRole("list", { name: "Repositories" });

    await user.type(screen.getByLabelText("Search repositories"), "ACME/WEB");

    expect(offered().map(([name]) => name)).toEqual(["acme/web", "acme/web-admin"]);
  });

  it("watches a ticked repository through the token it is offered with, and unwatches it", async () => {
    const personal = fakeGitHubToken("octocat");
    const work = fakeGitHubToken("acme", { owner_kind: "organization" });
    const api = installFakeApi({
      githubTokens: [personal, work],
      githubReadableRepositories: {
        octocat: [{ github_repo_id: 1, full_name: "octocat/dotfiles" }],
        acme: [{ github_repo_id: 2, full_name: "acme/api" }],
      },
    });
    const user = await openGitHubSettings();

    await user.click(await screen.findByRole("checkbox", { name: "acme/api" }));

    await waitFor(() => expect(screen.getByRole("checkbox", { name: "acme/api" })).toBeChecked());
    expect(api.watchedRepositories.map((w) => [w.full_name, w.github_token_id])).toEqual([
      ["acme/api", work.id],
    ]);

    await user.click(screen.getByRole("checkbox", { name: "acme/api" }));

    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "acme/api" })).not.toBeChecked(),
    );
    expect(api.watchedRepositories).toEqual([]);
  });

  it("after a token is removed, offers its repositories another token still reads", async () => {
    const personal = fakeGitHubToken("octocat");
    const work = fakeGitHubToken("acme", { owner_kind: "organization" });
    const api = installFakeApi({
      githubTokens: [personal, work],
      githubReadableRepositories: {
        octocat: [{ github_repo_id: 2, full_name: "acme/api" }],
        acme: [
          { github_repo_id: 2, full_name: "acme/api" },
          { github_repo_id: 3, full_name: "acme/web" },
        ],
      },
      watchedRepositories: [
        { github_token_id: work.id, github_repo_id: 2, full_name: "acme/api" },
        { github_token_id: work.id, github_repo_id: 3, full_name: "acme/web" },
      ],
    });
    const user = await openGitHubSettings();
    await screen.findByRole("list", { name: "Repositories" });

    await user.click(screen.getByRole("button", { name: "Remove GitHub Token for acme" }));
    await user.click(screen.getByRole("button", { name: "Remove token" }));

    await waitFor(() => expect(offered()).toEqual([["acme/api", false]]));
    await user.click(screen.getByRole("checkbox", { name: "acme/api" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "acme/api" })).toBeChecked());
    expect(api.watchedRepositories.map((w) => w.github_token_id)).toEqual([personal.id]);
  });

  it("explains that an organisation may need to approve a token that reads no repositories", async () => {
    installFakeApi({
      githubTokens: [
        fakeGitHubToken("octocat"),
        fakeGitHubToken("acme", { owner_kind: "organization" }),
      ],
      githubReadableRepositories: {
        octocat: [{ github_repo_id: 1, full_name: "octocat/dotfiles" }],
      },
    });

    await openGitHubSettings();

    const section = await screen.findByRole("region", { name: "Watched Repositories" });
    expect(
      await within(section).findByText(/GitHub lists no repositories for the acme token/),
    ).toHaveTextContent(/organisation may need to allow or approve fine-grained tokens/);
    expect(within(section).queryByText(/for the octocat token/)).toBeNull();
  });

  it("still offers the other tokens' repositories when GitHub can't be reached for one", async () => {
    installFakeApi({
      githubTokens: [
        fakeGitHubToken("octocat"),
        fakeGitHubToken("acme", { owner_kind: "organization" }),
      ],
      githubReadableRepositories: {
        octocat: [{ github_repo_id: 1, full_name: "octocat/dotfiles" }],
        acme: [{ github_repo_id: 2, full_name: "acme/api" }],
      },
      githubRepositoryFailures: { acme: "unavailable" },
    });

    await openGitHubSettings();

    expect(
      await screen.findByText(/GitHub couldn’t be reached for the acme token’s repositories/),
    ).toBeInTheDocument();
    expect(offered()).toEqual([["octocat/dotfiles", false]]);
  });
});
