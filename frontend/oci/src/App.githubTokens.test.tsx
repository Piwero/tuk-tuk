import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "./App";
import { fakeGitHubToken, installFakeApi } from "./test/fakeApi";

/** Settings › GitHub (#578): adding, listing and removing GitHub Tokens,
 * rendered against the fake API. */

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

/** Each listed token as [owner, details]. */
function listedTokens(): string[][] {
  const list = screen.queryByRole("list", { name: "GitHub Tokens" });
  if (list === null) {
    return [];
  }
  return within(list)
    .getAllByRole("listitem")
    .map((item) => [
      within(item).getByRole("heading").textContent ?? "",
      within(item).getByText(/·/).textContent ?? "",
    ]);
}

describe("Settings › GitHub", () => {
  it("is its own tab, listing each GitHub Token by owner, kind and expiry", async () => {
    installFakeApi({
      githubTokens: [
        fakeGitHubToken("octocat", { expires_at: "2027-02-01T08:00:00Z" }),
        fakeGitHubToken("acme", { owner_kind: "organization", expires_at: null }),
      ],
    });

    await openGitHubSettings();

    expect(window.location.pathname).toBe("/settings/github");
    await screen.findByRole("list", { name: "GitHub Tokens" });
    expect(listedTokens()).toEqual([
      ["octocat", "Your account · Expires Feb 1, 2027"],
      ["acme", "Organization · No expiry"],
    ]);
  });

  it("adds a pasted token GitHub accepts and lists it by its owner", async () => {
    const api = installFakeApi({
      githubTokenIdentities: {
        github_pat_acme: { owner_login: "acme", owner_kind: "organization" },
      },
    });
    const user = await openGitHubSettings();

    await user.type(await screen.findByLabelText("GitHub Token"), "github_pat_acme");
    await user.click(screen.getByRole("button", { name: "Add token" }));

    await screen.findByRole("list", { name: "GitHub Tokens" });
    expect(listedTokens()).toEqual([["acme", "Organization · No expiry"]]);
    expect(screen.getByLabelText("GitHub Token")).toHaveValue("");
    expect(api.requests).toContainEqual({
      method: "POST",
      url: "/api/v1/github/tokens",
      body: { token: "github_pat_acme" },
    });
  });

  it.each([
    ["a classic token", "ghp_classic", {}, /only fine-grained personal access tokens/],
    ["a token GitHub rejects", "github_pat_mistyped", {}, /GitHub rejected this token/],
    [
      "a token GitHub can't be reached to check",
      "github_pat_acme",
      { githubUnavailable: true },
      /Nothing was saved; try again/,
    ],
  ])("explains why %s is not saved", async (_case, pasted, options, explanation) => {
    installFakeApi({
      githubTokenIdentities: { github_pat_acme: { owner_login: "acme" } },
      ...options,
    });
    const user = await openGitHubSettings();

    await user.type(await screen.findByLabelText("GitHub Token"), pasted);
    await user.click(screen.getByRole("button", { name: "Add token" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(explanation);
    expect(listedTokens()).toEqual([]);
    expect(screen.getByLabelText("GitHub Token")).toHaveValue(pasted);
  });

  it("refuses a second token for an owner already covered", async () => {
    installFakeApi({
      githubTokens: [fakeGitHubToken("acme", { owner_kind: "organization" })],
      githubTokenIdentities: { github_pat_acme2: { owner_login: "acme" } },
    });
    const user = await openGitHubSettings();

    await user.type(await screen.findByLabelText("GitHub Token"), "github_pat_acme2");
    await user.click(screen.getByRole("button", { name: "Add token" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You already have a GitHub Token for acme",
    );
    expect(listedTokens()).toHaveLength(1);
  });

  it("removes a GitHub Token after confirming", async () => {
    const api = installFakeApi({ githubTokens: [fakeGitHubToken("octocat")] });
    const user = await openGitHubSettings();

    await user.click(
      await screen.findByRole("button", { name: "Remove GitHub Token for octocat" }),
    );
    await user.click(screen.getByRole("button", { name: "Remove token" }));

    await waitFor(() => expect(listedTokens()).toEqual([]));
    expect(api.githubTokens).toEqual([]);
    expect(screen.getByText("No GitHub Tokens yet.")).toBeInTheDocument();
  });
});
