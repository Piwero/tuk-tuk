import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { ApiError, createApiToken, fetchApiTokens, revokeApiToken } from "./api";
import {
  FAKE_ADMIN,
  type FakeApiState,
  fakeApiToken,
  fakeUser,
  installFakeApi,
} from "./test/fakeApi";

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

async function openMyAccount(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "Account menu" }));
  await user.click(screen.getByRole("menuitem", { name: "My account" }));
  return user;
}

describe("API tokens", () => {
  it("follow the Profile card, before Personalize, saying a token lets a client act as you", async () => {
    installFakeApi();
    await openMyAccount();

    const card = await screen.findByRole("region", { name: "API tokens" });

    expect(card).toHaveTextContent("For the MCP server and other clients acting as you.");
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent ?? "");
    const order = ["Profile", "API tokens", "Personalize"];
    expect(headings.filter((h) => order.includes(h))).toEqual(order);
    expect(screen.getByRole("link", { name: "API tokens" })).toHaveAttribute(
      "href",
      "#settings-api-tokens",
    );
  });

  it("lists each token with its name, prefix, created date and last use", async () => {
    installFakeApi({
      apiTokens: [
        fakeApiToken(FAKE_ADMIN.id, "Voice agent", {
          created_at: "2026-10-12T09:00:00Z",
          last_used_at: daysAgo(1),
        }),
        fakeApiToken(FAKE_ADMIN.id, "Claude on laptop", {
          created_at: "2026-10-20T09:00:00Z",
          last_used_at: null,
        }),
      ],
    });
    await openMyAccount();

    const card = await screen.findByRole("region", { name: "API tokens" });
    const items = await within(card).findAllByRole("listitem");

    expect(items.map((item) => within(item).getByRole("heading").textContent)).toEqual([
      "Claude on laptop",
      "Voice agent",
    ]);
    expect(items[0]).toHaveTextContent("Created Oct 20, 2026");
    expect(items[0]).toHaveTextContent("Never used");
    expect(items[1]).toHaveTextContent(/tuk_pat_1_[0-9a-f]{8}/);
    expect(items[1]).toHaveTextContent("Created Oct 12, 2026");
    expect(items[1]).toHaveTextContent("Last used yesterday");
  });

  it("lists only the signed-in user's own tokens", async () => {
    const member = fakeUser("bea");
    installFakeApi({
      users: [FAKE_ADMIN, member],
      apiTokens: [fakeApiToken(member.id, "Bea's laptop"), fakeApiToken(FAKE_ADMIN.id, "Mine")],
    });
    await openMyAccount();

    const card = await screen.findByRole("region", { name: "API tokens" });

    expect(await within(card).findByRole("heading", { name: "Mine" })).toBeInTheDocument();
    expect(within(card).queryByText("Bea's laptop")).not.toBeInTheDocument();
  });

  it("explains what a token is for when there are none, and offers New token", async () => {
    installFakeApi();
    await openMyAccount();

    const card = await screen.findByRole("region", { name: "API tokens" });

    expect(
      await within(card).findByText(
        "No tokens yet. Create one to connect the MCP server or another client to your account.",
      ),
    ).toBeInTheDocument();
    expect(within(card).queryByRole("listitem")).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "New token" })).toBeInTheDocument();
  });

  it("says when the list can't be read, and Retry reads it again", async () => {
    const api = installFakeApi({ apiTokens: [fakeApiToken(FAKE_ADMIN.id, "Voice agent")] });
    api.failRead = (pathname) => pathname === "/api/v1/auth/me/tokens";
    const user = await openMyAccount();

    const card = await screen.findByRole("region", { name: "API tokens" });
    expect(await within(card).findByRole("alert")).toHaveTextContent("Couldn’t load your tokens.");
    expect(within(card).queryByText(/No tokens yet/)).not.toBeInTheDocument();

    api.failRead = null;
    await user.click(within(card).getByRole("button", { name: "Retry" }));

    expect(await within(card).findByRole("heading", { name: "Voice agent" })).toBeInTheDocument();
    expect(within(card).queryByRole("alert")).not.toBeInTheDocument();
  });
});

function tokenCreates(api: FakeApiState): unknown[] {
  return api.requests
    .filter((r) => r.method === "POST" && r.url === "/api/v1/auth/me/tokens")
    .map((r) => r.body);
}

async function createToken(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
  await user.click(await screen.findByRole("button", { name: "New token" }));
  await user.type(screen.getByLabelText("Token name"), `${name}{Enter}`);
}

function storedValues(): string {
  const stores = [window.localStorage, window.sessionStorage];
  return stores
    .flatMap((store) => Object.keys(store).map((key) => `${key}=${store.getItem(key) ?? ""}`))
    .join("\n");
}

describe("Creating an API token", () => {
  it("asks for a name, then shows the value once, in place at the top of the list", async () => {
    const api = installFakeApi({
      apiTokens: [fakeApiToken(FAKE_ADMIN.id, "Voice agent", { created_at: daysAgo(30) })],
    });
    const user = await openMyAccount();

    await user.click(await screen.findByRole("button", { name: "New token" }));
    expect(screen.getByLabelText("Token name")).toHaveFocus();
    await user.type(screen.getByLabelText("Token name"), "Claude on laptop{Enter}");

    const card = screen.getByRole("region", { name: "API tokens" });
    const value = api.apiTokens.find((token) => token.name === "Claude on laptop")?.token ?? "";
    expect(value).toMatch(/^tuk_pat_1_[0-9a-f]{64}$/);
    const items = await within(card).findAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0] as HTMLElement).getByRole("heading")).toHaveTextContent(
      "Claude on laptop",
    );
    expect(items[0]).toHaveTextContent("New");
    expect(within(items[0] as HTMLElement).getByText(value)).toBeInTheDocument();
    expect(items[0]).toHaveTextContent("Copy it now. This is the only time the token is shown.");
    expect(within(items[0] as HTMLElement).getByRole("button", { name: "Copy" })).toHaveFocus();
    expect(within(items[1] as HTMLElement).queryByText(/tuk_pat_1_[0-9a-f]{64}/)).toBeNull();
    expect(screen.queryByLabelText("Token name")).not.toBeInTheDocument();
    expect(tokenCreates(api)).toEqual([{ name: "Claude on laptop", kind: "api" }]);
  });

  it("makes an MCP token when asked, for the shared MCP server only", async () => {
    const api = installFakeApi({
      apiTokens: [fakeApiToken(FAKE_ADMIN.id, "Script", { created_at: daysAgo(30) })],
    });
    const user = await openMyAccount();

    await user.click(await screen.findByRole("button", { name: "New token" }));
    const use = screen.getByRole("radiogroup", { name: "Used by" });
    expect(within(use).getByRole("radio", { name: "Other clients (API)" })).toBeChecked();
    await user.click(within(use).getByRole("radio", { name: "MCP server" }));
    await user.type(screen.getByLabelText("Token name"), "Claude Code{Enter}");

    const value = api.apiTokens.find((token) => token.name === "Claude Code")?.token ?? "";
    expect(value).toMatch(/^tuk_mcp_1_[0-9a-f]{64}$/);
    const card = screen.getByRole("region", { name: "API tokens" });
    expect(await within(card).findByText(value)).toBeInTheDocument();
    expect(tokenCreates(api)).toEqual([{ name: "Claude Code", kind: "mcp" }]);
    expect(within(card).getAllByRole("listitem")[1]).toHaveTextContent("API ·");
  });

  it("labels each listed token with what it is used by", async () => {
    installFakeApi({
      apiTokens: [
        fakeApiToken(FAKE_ADMIN.id, "Script", { created_at: "2026-10-12T09:00:00Z" }),
        fakeApiToken(FAKE_ADMIN.id, "Claude Code", {
          created_at: "2026-10-20T09:00:00Z",
          kind: "mcp",
        }),
      ],
    });
    await openMyAccount();

    const card = await screen.findByRole("region", { name: "API tokens" });
    const items = await within(card).findAllByRole("listitem");

    expect(items[0]).toHaveTextContent(/MCP server · tuk_mcp_1_[0-9a-f]{8}/);
    expect(items[1]).toHaveTextContent(/API · tuk_pat_1_[0-9a-f]{8}/);
  });

  it("never writes the value to browser storage", async () => {
    const api = installFakeApi();
    const user = await openMyAccount();

    await createToken(user, "Claude on laptop");
    const value = api.apiTokens[0]?.token ?? "";
    expect(await screen.findByText(value)).toBeInTheDocument();

    expect(storedValues()).not.toContain(value);
  });

  it("drops the value for good once the page is left, even coming back", async () => {
    const api = installFakeApi();
    const user = await openMyAccount();
    await createToken(user, "Claude on laptop");
    const value = api.apiTokens[0]?.token ?? "";
    expect(await screen.findByText(value)).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Users" }));
    await waitFor(() => expect(window.location.pathname).toBe("/settings/users"));
    window.history.back();

    const card = await screen.findByRole("region", { name: "API tokens" });
    const item = await within(card).findByRole("listitem");
    expect(item).toHaveTextContent("Claude on laptop");
    expect(item).toHaveTextContent(api.apiTokens[0]?.prefix ?? "");
    expect(screen.queryByText(value)).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(value);
  });

  it("collapses the previous value when another token is created", async () => {
    const api = installFakeApi();
    const user = await openMyAccount();
    await createToken(user, "Claude on laptop");
    const first = api.apiTokens[0]?.token ?? "";
    expect(await screen.findByText(first)).toBeInTheDocument();

    await createToken(user, "Voice agent");

    const second = api.apiTokens[1]?.token ?? "";
    expect(await screen.findByText(second)).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(first);
    const items = within(screen.getByRole("region", { name: "API tokens" })).getAllByRole(
      "listitem",
    );
    expect(items.map((item) => within(item).getByRole("heading").textContent)).toEqual([
      "Voice agent",
      "Claude on laptop",
    ]);
    expect(items[1]).toHaveTextContent("Never used");
  });

  it("copies the value and confirms on the button", async () => {
    const api = installFakeApi();
    const user = await openMyAccount();
    await createToken(user, "Claude on laptop");
    const value = api.apiTokens[0]?.token ?? "";

    await user.click(await screen.findByRole("button", { name: "Copy" }));

    expect(await navigator.clipboard.readText()).toBe(value);
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("selects the value for copying by hand when the clipboard refuses", async () => {
    const api = installFakeApi();
    const user = await openMyAccount();
    await createToken(user, "Claude on laptop");
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));

    await user.click(await screen.findByRole("button", { name: "Copy" }));

    expect(window.getSelection()?.toString()).toBe(api.apiTokens[0]?.token);
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it.each([
    ["an empty name", "   "],
    ["a name over 100 characters", "x".repeat(101)],
  ])("catches %s on the field without asking the server", async (_case, name) => {
    const api = installFakeApi();
    const user = await openMyAccount();
    await user.click(await screen.findByRole("button", { name: "New token" }));
    const field = screen.getByLabelText("Token name");

    await user.click(field);
    await user.paste(name);
    await user.keyboard("{Enter}");

    const message = "Name must be 1 to 100 characters.";
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(field).toHaveAccessibleDescription(message);
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveFocus();
    expect(tokenCreates(api)).toEqual([]);
  });

  it.each([
    [
      "Cancel",
      async (user: ReturnType<typeof userEvent.setup>) => {
        await user.click(screen.getByRole("button", { name: "Cancel" }));
      },
    ],
    [
      "Escape",
      async (user: ReturnType<typeof userEvent.setup>) => {
        await user.keyboard("{Escape}");
      },
    ],
  ])("closes the name field on %s without a request, back on New token", async (_how, close) => {
    const api = installFakeApi();
    const user = await openMyAccount();
    await user.click(await screen.findByRole("button", { name: "New token" }));
    await user.type(screen.getByLabelText("Token name"), "Half typed");

    await close(user);

    expect(screen.queryByLabelText("Token name")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New token" })).toHaveFocus();
    expect(tokenCreates(api)).toEqual([]);
  });
});

function tokenRevokes(api: FakeApiState): string[] {
  return api.requests.filter((r) => r.method === "DELETE").map((r) => r.url);
}

describe("Revoking an API token", () => {
  it("asks once, naming the token, then removes it from the list", async () => {
    const voice = fakeApiToken(FAKE_ADMIN.id, "Voice agent", { created_at: daysAgo(2) });
    const laptop = fakeApiToken(FAKE_ADMIN.id, "Claude on laptop", { created_at: daysAgo(1) });
    const api = installFakeApi({ apiTokens: [voice, laptop] });
    const user = await openMyAccount();

    await user.click(await screen.findByRole("button", { name: "Revoke Voice agent" }));

    const dialog = screen.getByRole("dialog", { name: "Revoke Voice agent?" });
    expect(dialog).toHaveTextContent(
      "Clients using this token stop working at once. This can’t be undone.",
    );
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.click(within(dialog).getByRole("button", { name: "Revoke token" }));

    const card = screen.getByRole("region", { name: "API tokens" });
    await waitFor(() => expect(within(card).getAllByRole("listitem")).toHaveLength(1));
    expect(within(card).queryByText("Voice agent")).not.toBeInTheDocument();
    expect(within(card).getByRole("heading", { name: "Claude on laptop" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New token" })).toHaveFocus();
    expect(tokenRevokes(api)).toEqual([`/api/v1/auth/me/tokens/${voice.id}`]);
    expect(api.apiTokens.find((token) => token.id === voice.id)?.revoked_at).not.toBeNull();
  });

  it("keeps the token when the confirm is cancelled", async () => {
    const api = installFakeApi({ apiTokens: [fakeApiToken(FAKE_ADMIN.id, "Voice agent")] });
    const user = await openMyAccount();
    const revoke = await screen.findByRole("button", { name: "Revoke Voice agent" });

    await user.click(revoke);
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(revoke).toHaveFocus();
    expect(screen.getByRole("heading", { name: "Voice agent" })).toBeInTheDocument();
    expect(tokenRevokes(api)).toEqual([]);
  });

  it("drops a token already revoked elsewhere from the list", async () => {
    const voice = fakeApiToken(FAKE_ADMIN.id, "Voice agent");
    const api = installFakeApi({ apiTokens: [voice] });
    const user = await openMyAccount();
    await user.click(await screen.findByRole("button", { name: "Revoke Voice agent" }));
    const stored = api.apiTokens.find((token) => token.id === voice.id);
    if (stored !== undefined) stored.revoked_at = new Date().toISOString();

    await user.click(screen.getByRole("button", { name: "Revoke token" }));

    expect(
      await screen.findByText(
        "No tokens yet. Create one to connect the MCP server or another client to your account.",
      ),
    ).toBeInTheDocument();
  });
});

describe("The fake token endpoints", () => {
  const notFound = (err: unknown): boolean =>
    err instanceof ApiError && err.status === 404 && err.code === "not_found";

  it("refuse to revoke another user's token or one already revoked", async () => {
    const member = fakeUser("bea");
    const theirs = fakeApiToken(member.id, "Bea's laptop");
    const gone = fakeApiToken(FAKE_ADMIN.id, "Old", { revoked_at: "2026-02-01T00:00:00Z" });
    const api = installFakeApi({ users: [FAKE_ADMIN, member], apiTokens: [theirs, gone] });

    await expect(revokeApiToken(theirs.id)).rejects.toSatisfy(notFound);
    await expect(revokeApiToken(gone.id)).rejects.toSatisfy(notFound);
    await expect(revokeApiToken(9999)).rejects.toSatisfy(notFound);
    expect(api.apiTokens.find((token) => token.id === theirs.id)?.revoked_at).toBeNull();
  });

  it("return the value on creation only, and reject a blank name", async () => {
    installFakeApi();

    const created = await createApiToken("  CLI  ");

    expect(created).toMatchObject({ name: "CLI", last_used_at: null });
    expect(created.token.startsWith(created.prefix)).toBe(true);
    expect((await fetchApiTokens()).items).toEqual([
      {
        id: created.id,
        name: "CLI",
        kind: "api",
        prefix: created.prefix,
        created_at: created.created_at,
        last_used_at: null,
      },
    ]);
    await expect(createApiToken(" ")).rejects.toSatisfy(
      (err: unknown) => err instanceof ApiError && err.code === "invalid_token_name",
    );
  });
});
