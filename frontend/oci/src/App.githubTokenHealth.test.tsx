import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeGitHubPullRequest, fakeGitHubToken, installFakeApi } from "./test/fakeApi";

/** GitHub Token health (#584): per-token banners in the GitHub view,
 * needs_reconnect and Reconnect in Settings, and the expiry warning,
 * rendered against the fake API. */

beforeEach(() => {
  // Expiry wording depends on today: pinned so it never drifts.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-11-26T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

async function openGitHub(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<App />);
  const nav = await screen.findByRole("navigation", { name: "GitHub" });
  await user.click(within(nav).getByRole("link", { name: "GitHub" }));
  return user;
}

async function openGitHubSettings(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  window.history.replaceState(null, "", "/settings/github");
  render(<App />);
  await screen.findByRole("list", { name: "GitHub Tokens" });
  return user;
}

function tokenItem(owner: string): HTMLElement {
  const list = screen.getByRole("list", { name: "GitHub Tokens" });
  const item = within(list)
    .getAllByRole("listitem")
    .find((li) => within(li).queryByRole("heading", { name: owner }) !== null);
  if (item === undefined) throw new Error(`No GitHub Token for ${owner}`);
  return item;
}

/** octocat/dotfiles through octocat's token and acme/api through acme's,
 * each with one open Pull Request. */
function twoTokens(
  octocat: Partial<ReturnType<typeof fakeGitHubToken>> = {},
): Parameters<typeof installFakeApi>[0] {
  const personal = fakeGitHubToken("octocat", octocat);
  const work = fakeGitHubToken("acme", { owner_kind: "organization" });
  return {
    githubTokens: [personal, work],
    watchedRepositories: [
      { github_token_id: personal.id, github_repo_id: 1, full_name: "octocat/dotfiles" },
      { github_token_id: work.id, github_repo_id: 2, full_name: "acme/api" },
    ],
    githubPullRequests: [
      fakeGitHubPullRequest(1, "Tidy dotfiles", { repository: "octocat/dotfiles" }),
      fakeGitHubPullRequest(2, "Ship the API", { repository: "acme/api" }),
    ],
  };
}

describe("GitHub view › token health", () => {
  it("names a token GitHub rejects in its own banner and still renders the other tokens' Pull Requests", async () => {
    installFakeApi({ ...twoTokens(), githubRepositoryFailures: { octocat: "needs_reconnect" } });

    await openGitHub();

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("GitHub no longer accepts the GitHub Token for octocat");
    expect(within(banner).getByRole("link", { name: "Reconnect" })).toHaveAttribute(
      "href",
      "/settings/github",
    );
    expect(screen.getByRole("link", { name: "Ship the API" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Tidy dotfiles" })).not.toBeInTheDocument();
  });

  it("names a token GitHub couldn't be reached through, without asking to reconnect it", async () => {
    installFakeApi({ ...twoTokens(), githubRepositoryFailures: { octocat: "unavailable" } });

    await openGitHub();

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("GitHub couldn’t be reached for octocat’s repositories");
    expect(within(banner).queryByRole("link", { name: "Reconnect" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ship the API" })).toBeInTheDocument();
  });

  it("warns when a token expires within 7 days, naming it and its expiry date", async () => {
    installFakeApi(twoTokens({ expires_at: "2026-11-30T08:00:00Z", expires_soon: true }));

    await openGitHub();

    const warning = await screen.findByRole("status", { name: "GitHub Token expiry" });
    expect(warning).toHaveTextContent("The GitHub Token for octocat expires on Nov 30, 2026");
    expect(warning).not.toHaveTextContent("acme");
    expect(screen.getByRole("link", { name: "Tidy dotfiles" })).toBeInTheDocument();
  });

  it("says a token has expired once its expiry has passed", async () => {
    installFakeApi(twoTokens({ expires_at: "2026-11-25T08:00:00Z", expires_soon: true }));

    await openGitHub();

    expect(await screen.findByRole("status", { name: "GitHub Token expiry" })).toHaveTextContent(
      "The GitHub Token for octocat expired on Nov 25, 2026",
    );
  });
});

describe("Settings › GitHub › token health", () => {
  it("shows a token GitHub rejected as needing reconnection, and reconnects it with a replacement", async () => {
    const octocat = fakeGitHubToken("octocat", { connection_state: "needs_reconnect" });
    const api = installFakeApi({
      githubTokens: [octocat],
      githubTokenIdentities: { github_pat_rotated: { owner_login: "octocat" } },
    });
    const user = await openGitHubSettings();

    expect(within(tokenItem("octocat")).getByRole("alert")).toHaveTextContent(
      "GitHub no longer accepts this token",
    );
    await user.click(
      within(tokenItem("octocat")).getByRole("button", {
        name: "Reconnect GitHub Token for octocat",
      }),
    );
    await user.type(screen.getByLabelText("Replacement token for octocat"), "github_pat_rotated");
    await user.click(screen.getByRole("button", { name: "Reconnect" }));

    await waitFor(() =>
      expect(within(tokenItem("octocat")).queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(api.requests).toContainEqual({
      method: "PATCH",
      url: `/api/v1/github/tokens/${octocat.id}`,
      body: { token: "github_pat_rotated" },
    });
    expect(api.githubTokens[0]?.connection_state).toBe("connected");
  });

  it("refuses a replacement for a different owner and keeps the token as it was", async () => {
    const octocat = fakeGitHubToken("octocat", { connection_state: "needs_reconnect" });
    const api = installFakeApi({
      githubTokens: [octocat],
      githubTokenIdentities: { github_pat_acme: { owner_login: "acme" } },
    });
    const user = await openGitHubSettings();

    await user.click(
      within(tokenItem("octocat")).getByRole("button", {
        name: "Reconnect GitHub Token for octocat",
      }),
    );
    await user.type(screen.getByLabelText("Replacement token for octocat"), "github_pat_acme");
    await user.click(screen.getByRole("button", { name: "Reconnect" }));

    expect(
      await within(tokenItem("octocat")).findByText(/This token grants access to acme/),
    ).toBeInTheDocument();
    expect(api.githubTokens[0]?.connection_state).toBe("needs_reconnect");
  });

  it("warns about a token that expires within 7 days, naming it", async () => {
    installFakeApi({
      githubTokens: [
        fakeGitHubToken("octocat", { expires_at: "2026-11-30T08:00:00Z", expires_soon: true }),
        fakeGitHubToken("acme", { expires_at: "2027-02-01T08:00:00Z" }),
      ],
    });

    await openGitHubSettings();

    const warning = screen.getByRole("status", { name: "GitHub Token expiry" });
    expect(warning).toHaveTextContent("The GitHub Token for octocat expires on Nov 30, 2026");
    expect(warning).not.toHaveTextContent("acme");
  });

  it("shows no expiry warning while every token has more than 7 days left", async () => {
    installFakeApi({
      githubTokens: [fakeGitHubToken("octocat", { expires_at: "2027-02-01T08:00:00Z" })],
    });

    await openGitHubSettings();

    expect(screen.queryByRole("status", { name: "GitHub Token expiry" })).not.toBeInTheDocument();
  });
});
