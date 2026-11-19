import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { AuthGate } from "./AuthGate";
import { FAKE_ADMIN, type FakeApiState, fakeUser, installFakeApi } from "./test/fakeApi";

/** Settings › Users row actions (#481): an Admin makes someone an admin or a
 * Member, and disables or re-enables an account. Rendered against the fake
 * API, signed in as FAKE_ADMIN ("admin") unless a test seeds otherwise. */

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

async function openUsers(ui: JSX.Element = <App />): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(ui);
  await user.click(await screen.findByRole("button", { name: "Account menu" }));
  await user.click(screen.getByRole("menuitem", { name: "Users" }));
  await screen.findByRole("table", { name: "Users" });
  return user;
}

/** The body row whose row header names `username`. */
function rowOf(username: string): HTMLElement {
  const table = screen.getByRole("table", { name: "Users" });
  const row = within(table)
    .getAllByRole("row")
    .find((candidate) =>
      within(candidate)
        .queryAllByRole("rowheader")
        .some((header) => header.textContent?.includes(username)),
    );
  if (row === undefined) throw new Error(`No row for ${username}`);
  return row;
}

/** Row headers top to bottom: the usernames in listed order. */
function listedNames(): string[] {
  const table = screen.getByRole("table", { name: "Users" });
  return within(table)
    .getAllByRole("rowheader")
    .map((header) => header.querySelector(".users-name")?.firstChild?.textContent ?? "");
}

function writes(api: FakeApiState): { url: string; body: unknown }[] {
  return api.requests
    .filter((r) => r.method !== "GET" && r.url.startsWith("/api/v1/admin/users"))
    .map(({ url, body }) => ({ url, body }));
}

async function openRowMenu(
  user: ReturnType<typeof userEvent.setup>,
  username: string,
): Promise<HTMLElement> {
  await user.click(
    within(rowOf(username)).getByRole("button", { name: `Actions for ${username}` }),
  );
  return screen.getByRole("menu", { name: `Actions for ${username}` });
}

describe("Changing a user's role", () => {
  it("makes a Member an admin and re-reads the list", async () => {
    const ines = fakeUser("ines");
    const api = installFakeApi({ users: [FAKE_ADMIN, ines] });
    const user = await openUsers();

    const menu = await openRowMenu(user, "ines");
    await user.click(within(menu).getByRole("menuitem", { name: "Make admin" }));

    await waitFor(() => {
      expect(within(rowOf("ines")).getByRole("cell", { name: "Admin" })).toBeInTheDocument();
    });
    expect(writes(api)).toEqual([
      { url: `/api/v1/admin/users/${ines.id}`, body: { is_admin: true } },
    ]);
    expect(
      api.requests.filter((r) => r.method === "GET" && r.url.startsWith("/api/v1/admin/users")),
    ).toHaveLength(2);
    expect(screen.queryByRole("menu", { name: "Actions for ines" })).not.toBeInTheDocument();
  });

  it("removes admin from an Admin while another active admin remains", async () => {
    const ines = fakeUser("ines", { is_admin: true });
    const api = installFakeApi({ users: [FAKE_ADMIN, ines] });
    const user = await openUsers();

    const menu = await openRowMenu(user, "ines");
    expect(within(menu).queryByRole("menuitem", { name: "Make admin" })).not.toBeInTheDocument();
    await user.click(within(menu).getByRole("menuitem", { name: "Remove admin" }));

    await waitFor(() => {
      expect(within(rowOf("ines")).getByRole("cell", { name: "Member" })).toBeInTheDocument();
    });
    expect(writes(api)).toEqual([
      { url: `/api/v1/admin/users/${ines.id}`, body: { is_admin: false } },
    ]);
  });
});

describe("Disabling and enabling a user", () => {
  it("asks to confirm, says the person is signed out at once, then lists them Disabled and last", async () => {
    const ines = fakeUser("ines");
    const api = installFakeApi({ users: [FAKE_ADMIN, ines, fakeUser("tomas")] });
    const user = await openUsers();

    await user.click(
      within(await openRowMenu(user, "ines")).getByRole("menuitem", { name: "Disable user" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Disable ines?" });
    expect(dialog).toHaveTextContent(/ines is signed out at once/);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(writes(api)).toEqual([]);
    expect(within(rowOf("ines")).getByRole("button", { name: "Actions for ines" })).toHaveFocus();

    await user.click(
      within(await openRowMenu(user, "ines")).getByRole("menuitem", { name: "Disable user" }),
    );
    await user.click(
      within(screen.getByRole("dialog", { name: "Disable ines?" })).getByRole("button", {
        name: "Disable user",
      }),
    );

    await waitFor(() => {
      expect(within(rowOf("ines")).getByText("Disabled")).toBeInTheDocument();
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(listedNames()).toEqual(["admin", "tomas", "ines"]);
    expect(writes(api)).toEqual([
      { url: `/api/v1/admin/users/${ines.id}`, body: { is_active: false } },
    ]);
  });

  it("offers Enable in place of Disable on a disabled row, and enables without a confirm", async () => {
    const marta = fakeUser("marta", { is_active: false });
    const api = installFakeApi({ users: [FAKE_ADMIN, marta, fakeUser("tomas")] });
    const user = await openUsers();
    expect(listedNames()).toEqual(["admin", "tomas", "marta"]);

    const menu = await openRowMenu(user, "marta");
    expect(within(menu).queryByRole("menuitem", { name: "Disable user" })).not.toBeInTheDocument();
    await user.click(within(menu).getByRole("menuitem", { name: "Enable user" }));

    await waitFor(() => {
      expect(within(rowOf("marta")).getByText("Active")).toBeInTheDocument();
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(listedNames()).toEqual(["admin", "marta", "tomas"]);
    expect(writes(api)).toEqual([
      { url: `/api/v1/admin/users/${marta.id}`, body: { is_active: true } },
    ]);
  });

  it("offers no way to delete an account", async () => {
    installFakeApi({
      users: [
        FAKE_ADMIN,
        fakeUser("ines", { is_admin: true }),
        fakeUser("marta", { is_active: false }),
      ],
    });
    const user = await openUsers();

    for (const username of ["admin", "ines", "marta"]) {
      const menu = await openRowMenu(user, username);
      const entries = within(menu)
        .getAllByRole("menuitem")
        .map((entry) => entry.textContent);
      expect(entries).not.toContainEqual(expect.stringMatching(/delete|remove user/i));
      await user.keyboard("{Escape}");
    }
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
  });
});

describe("The last active admin", () => {
  const REASON = "An instance needs at least one active admin.";

  it("can't be disabled or lose admin, with the reason shown, even beside a disabled admin", async () => {
    const api = installFakeApi({
      users: [FAKE_ADMIN, fakeUser("zed", { is_admin: true, is_active: false })],
    });
    const user = await openUsers();

    const menu = await openRowMenu(user, "admin");
    expect(screen.getByText(REASON)).toBeVisible();
    for (const name of ["Remove admin", "Disable user"]) {
      const entry = within(menu).getByRole("menuitem", { name });
      expect(entry).toHaveAttribute("aria-disabled", "true");
      expect(entry).toHaveAccessibleDescription(REASON);
    }
    await user.click(within(menu).getByRole("menuitem", { name: "Disable user" }));
    await user.click(within(menu).getByRole("menuitem", { name: "Remove admin" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(writes(api)).toEqual([]);
    expect(within(rowOf("admin")).getByText("Active")).toBeInTheDocument();
  });

  it("leaves another admin's row free while two admins are active", async () => {
    installFakeApi({ users: [FAKE_ADMIN, fakeUser("ines", { is_admin: true })] });
    const user = await openUsers();

    const menu = await openRowMenu(user, "admin");
    expect(screen.queryByText(REASON)).not.toBeInTheDocument();
    for (const name of ["Remove admin", "Disable user"]) {
      expect(within(menu).getByRole("menuitem", { name })).not.toHaveAttribute("aria-disabled");
    }
  });

  it("reports the server's refusal on the row and leaves the row as it was", async () => {
    const ines = fakeUser("ines", { is_admin: true });
    const api = installFakeApi({ users: [FAKE_ADMIN, ines] });
    const user = await openUsers();
    // Another admin disables ines after this list was read: the UI still
    // believes two admins are active, the server knows better.
    const stored = api.users.find((account) => account.id === ines.id);
    if (stored) stored.is_active = false;

    const menu = await openRowMenu(user, "admin");
    await user.click(within(menu).getByRole("menuitem", { name: "Remove admin" }));

    expect(await within(rowOf("admin")).findByRole("alert")).toHaveTextContent(
      "Couldn’t remove admin from admin. An instance needs at least one active admin.",
    );
    expect(within(rowOf("admin")).getByRole("cell", { name: "Admin" })).toBeInTheDocument();
    expect(writes(api)).toEqual([
      { url: `/api/v1/admin/users/${FAKE_ADMIN.id}`, body: { is_admin: false } },
    ]);
    expect(api.users.find((account) => account.id === FAKE_ADMIN.id)?.is_admin).toBe(true);
  });
});

describe("A failed action", () => {
  it("says what failed and leaves the row as it was", async () => {
    const ines = fakeUser("ines");
    installFakeApi({ users: [FAKE_ADMIN, ines, fakeUser("tomas")] });
    const passthrough = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH" && String(input).includes("/api/v1/admin/users/")) {
        return new Response(
          JSON.stringify({ error: { code: "internal_error", message: "Unavailable" } }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
      return passthrough(input as string, init);
    });
    const user = await openUsers();

    await user.click(
      within(await openRowMenu(user, "ines")).getByRole("menuitem", { name: "Disable user" }),
    );
    await user.click(
      within(screen.getByRole("dialog", { name: "Disable ines?" })).getByRole("button", {
        name: "Disable user",
      }),
    );

    expect(await within(rowOf("ines")).findByRole("alert")).toHaveTextContent(
      "Couldn’t disable ines. Try again.",
    );
    expect(within(rowOf("ines")).getByText("Active")).toBeInTheDocument();
    expect(listedNames()).toEqual(["admin", "ines", "tomas"]);

    await user.click(
      within(await openRowMenu(user, "ines")).getByRole("menuitem", { name: "Make admin" }),
    );
    expect(await within(rowOf("ines")).findByRole("alert")).toHaveTextContent(
      "Couldn’t make ines an admin. Try again.",
    );
    expect(within(rowOf("ines")).getByRole("cell", { name: "Member" })).toBeInTheDocument();
  });
});

describe("The row menu by keyboard", () => {
  it("opens with Enter or Space, moves with the arrow keys and closes with Escape", async () => {
    const ines = fakeUser("ines");
    const api = installFakeApi({ users: [FAKE_ADMIN, ines] });
    const user = await openUsers();
    const trigger = within(rowOf("ines")).getByRole("button", { name: "Actions for ines" });

    trigger.focus();
    await user.keyboard("{Enter}");
    const menu = screen.getByRole("menu", { name: "Actions for ines" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(within(menu).getByRole("menuitem", { name: "Make admin" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(within(menu).getByRole("menuitem", { name: "Disable user" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(within(menu).getByRole("menuitem", { name: "Make admin" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(within(menu).getByRole("menuitem", { name: "Disable user" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.keyboard(" ");
    expect(
      within(screen.getByRole("menu", { name: "Actions for ines" })).getByRole("menuitem", {
        name: "Make admin",
      }),
    ).toHaveFocus();
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(within(rowOf("ines")).getByRole("cell", { name: "Admin" })).toBeInTheDocument();
    });
    expect(writes(api)).toEqual([
      { url: `/api/v1/admin/users/${ines.id}`, body: { is_admin: true } },
    ]);
  });
});

describe("Acting on your own row", () => {
  it("lets an Admin remove their own admin while another admin is active, leaving Users", async () => {
    const api = installFakeApi({ users: [FAKE_ADMIN, fakeUser("ines", { is_admin: true })] });
    const user = await openUsers();

    await user.click(
      within(await openRowMenu(user, "admin")).getByRole("menuitem", { name: "Remove admin" }),
    );

    expect(await screen.findByLabelText("Username")).toHaveValue("admin");
    await waitFor(() => {
      expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
    });
    expect(window.location.pathname).toBe("/settings/account");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(writes(api)).toEqual([
      { url: `/api/v1/admin/users/${FAKE_ADMIN.id}`, body: { is_admin: false } },
    ]);
  });

  it("signs an Admin out with the disabled message when they disable themselves", async () => {
    const api = installFakeApi({
      loggedIn: true,
      users: [FAKE_ADMIN, fakeUser("ines", { is_admin: true })],
    });
    const user = await openUsers(<AuthGate />);

    await user.click(
      within(await openRowMenu(user, "admin")).getByRole("menuitem", { name: "Disable user" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Disable admin?" });
    expect(dialog).toHaveTextContent(/You are signed out at once/);
    await user.click(within(dialog).getByRole("button", { name: "Disable user" }));

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/disabled.*contact your admin/i);
    expect(screen.queryByRole("table", { name: "Users" })).not.toBeInTheDocument();
    expect(writes(api)).toEqual([
      { url: `/api/v1/admin/users/${FAKE_ADMIN.id}`, body: { is_active: false } },
    ]);
  });
});
