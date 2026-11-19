import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "./App";
import { FAKE_ADMIN, type FakeApiState, fakeUser, installFakeApi } from "./test/fakeApi";

/** Settings › Users (#477): the Admin's list of every account with its role
 * and status. Rendered against the fake API, signed in as FAKE_ADMIN unless a
 * test seeds its own `users`. */

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

async function openUsers(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "Account menu" }));
  await user.click(screen.getByRole("menuitem", { name: "Users" }));
  return user;
}

/** What a reader perceives in a cell: its text without aria-hidden parts
 * (the avatar's initial), whitespace collapsed. */
function perceived(cell: Element): string {
  const copy = cell.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll("[aria-hidden='true']")) {
    hidden.remove();
  }
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** The table's body rows, top to bottom, as [user, role, status, last
 * active] texts. */
function listedRows(): string[][] {
  const table = screen.getByRole("table", { name: "Users" });
  return within(table)
    .getAllByRole("row")
    .filter((row) => within(row).queryAllByRole("cell").length > 0)
    .map((row) => [
      perceived(within(row).getByRole("rowheader")),
      ...within(row).getAllByRole("cell").map(perceived),
    ]);
}

function listReads(api: FakeApiState): string[] {
  return api.requests
    .filter((r) => r.method === "GET" && r.url.startsWith("/api/v1/admin/users"))
    .map((r) => r.url);
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

describe("Users list", () => {
  it("lists every account with its role and status, marking the Admin's own row", async () => {
    const api = installFakeApi({
      users: [
        { ...FAKE_ADMIN, username: "rafa", email: "rafa@example.org" },
        fakeUser("ines", { email: "ines@example.org" }),
      ],
    });

    await openUsers();

    expect(await screen.findByRole("heading", { name: "2 users" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "You manage accounts here. You can’t see another user’s tasks, habits or settings.",
      ),
    ).toBeInTheDocument();
    expect(listedRows()).toEqual([
      ["rafa You rafa@example.org", "Admin", "Active", "Now"],
      ["ines ines@example.org", "Member", "Active", "Never"],
    ]);
    expect(listReads(api)).toHaveLength(1);
  });

  it("says when each account was last active, and Never for one nobody has used", async () => {
    const api = installFakeApi({
      users: [
        { ...FAKE_ADMIN, last_active_at: null },
        fakeUser("pat", { last_active_at: minutesAgo(3) }),
        fakeUser("ines", { last_active_at: minutesAgo(2 * 60 + 10) }),
        fakeUser("lu", { last_active_at: minutesAgo(6 * 24 * 60) }),
        fakeUser("noor", { last_active_at: "2026-03-04T10:00:00Z" }),
        fakeUser("tomas", { must_change_password: true, last_active_at: null }),
      ],
    });

    await openUsers();

    await screen.findByRole("table", { name: "Users" });
    expect(screen.getByRole("columnheader", { name: "Last active" })).toBeInTheDocument();
    expect(listedRows()).toEqual([
      ["admin You admin@example.com", "Admin", "Active", "Now"],
      ["pat pat@example.com", "Member", "Active", "Now"],
      ["ines ines@example.com", "Member", "Active", "2 hours ago"],
      ["lu lu@example.com", "Member", "Active", "6 days ago"],
      ["noor noor@example.com", "Member", "Active", "Mar 4, 2026"],
      ["tomas tomas@example.com", "Member", "Temporary password", "Never"],
    ]);
    expect(listReads(api)).toEqual(["/api/v1/admin/users?limit=200"]);
  });

  it("derives each status and lists disabled accounts last", async () => {
    installFakeApi({
      users: [
        FAKE_ADMIN,
        fakeUser("marta", { is_active: false }),
        fakeUser("tomas", { must_change_password: true }),
        fakeUser("ines"),
        fakeUser("old", { must_complete_profile: true, email: null }),
        fakeUser("zed", { is_active: false, is_admin: true, must_change_password: true }),
      ],
    });

    await openUsers();

    await screen.findByRole("table", { name: "Users" });
    expect(screen.getByRole("heading", { name: "6 users" })).toBeInTheDocument();
    expect(listedRows()).toEqual([
      ["admin You admin@example.com", "Admin", "Active", "Now"],
      ["tomas tomas@example.com", "Member", "Temporary password", "Never"],
      ["ines ines@example.com", "Member", "Active", "Never"],
      ["old", "Member", "Temporary password", "Never"],
      ["marta marta@example.com", "Member", "Disabled", "Never"],
      ["zed zed@example.com", "Admin", "Disabled", "Never"],
    ]);
  });

  it("counts a sole account as one user", async () => {
    installFakeApi();

    await openUsers();

    expect(await screen.findByRole("heading", { name: "1 user" })).toBeInTheDocument();
  });

  it("shows a busy placeholder until the list has loaded", async () => {
    let release = (): void => {};
    const api = installFakeApi();
    api.readGate = {
      match: (pathname) => pathname === "/api/v1/admin/users",
      gate: new Promise<void>((resolve) => {
        release = resolve;
      }),
    };

    await openUsers();

    const busy = await screen.findByRole("status", { name: "Loading users" });
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("table", { name: "Users" })).not.toBeInTheDocument();

    release();
    expect(await screen.findByRole("table", { name: "Users" })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading users" })).not.toBeInTheDocument();
  });

  it("offers Retry when the list fails to load, and Retry reads it again", async () => {
    const api = installFakeApi();
    api.failRead = (pathname) => pathname === "/api/v1/admin/users";
    const user = await openUsers();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn’t load users");
    expect(screen.queryByRole("table", { name: "Users" })).not.toBeInTheDocument();
    expect(listReads(api)).toHaveLength(1);

    api.failRead = null;
    await user.click(within(alert).getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("table", { name: "Users" })).toBeInTheDocument();
    expect(listReads(api)).toHaveLength(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Users list for non-admins", () => {
  it("is never read for a Member, whose Users URL shows My account", async () => {
    const member = fakeUser("bea");
    const api = installFakeApi({ users: [FAKE_ADMIN, member], sessionUserId: member.id });
    window.history.replaceState(null, "", "/settings/users");

    render(<App />);

    expect(await screen.findByLabelText("Username")).toHaveValue("bea");
    expect(window.location.pathname).toBe("/settings/account");
    expect(screen.queryByRole("region", { name: "Users" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Users" })).not.toBeInTheDocument();
    expect(listReads(api)).toEqual([]);
  });

  it("drops the Users tab and menu entry on the next navigation once admin rights are removed", async () => {
    const api = installFakeApi({ users: [FAKE_ADMIN, fakeUser("ines", { is_admin: true })] });
    const user = await openUsers();
    await screen.findByRole("table", { name: "Users" });

    const self = api.users.find((account) => account.id === FAKE_ADMIN.id);
    if (self) self.is_admin = false;
    await user.click(screen.getByRole("link", { name: "My account" }));

    expect(await screen.findByLabelText("Username")).toHaveValue("admin");
    await waitFor(() => {
      expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    expect(screen.getByRole("menuitem", { name: "My account" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Users" })).not.toBeInTheDocument();
  });

  it("sends someone demoted since Settings opened back to My account, without an error", async () => {
    const api = installFakeApi({ users: [FAKE_ADMIN, fakeUser("ines", { is_admin: true })] });
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/settings/account");
    render(<App />);
    const usersTab = await screen.findByRole("link", { name: "Users" });

    const self = api.users.find((account) => account.id === FAKE_ADMIN.id);
    if (self) self.is_admin = false;
    await user.click(usersTab);

    await waitFor(() => {
      expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
    });
    expect(window.location.pathname).toBe("/settings/account");
    expect(screen.getByLabelText("Username")).toHaveValue("admin");
    expect(screen.queryByRole("table", { name: "Users" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
