import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resetAdminUserPassword } from "./api";
import { App } from "./App";
import { generateTemporaryPassword } from "./auth/temporaryPassword";
import { AuthGate } from "./AuthGate";
import { FAKE_ADMIN, type FakeApiState, fakeUser, installFakeApi } from "./test/fakeApi";

/** Settings › Users › Reset password (#480): from a row's menu an Admin
 * gives an account a new temporary password, shown once in the same block as
 * New user. Rendered against the fake API, signed in as FAKE_ADMIN. */

afterEach(() => {
  vi.restoreAllMocks();
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

function resets(api: FakeApiState): { url: string; body: unknown }[] {
  return api.requests
    .filter((r) => r.method === "POST" && r.url.endsWith("/reset-password"))
    .map(({ url, body }) => ({ url, body }));
}

async function chooseReset(
  user: ReturnType<typeof userEvent.setup>,
  username: string,
): Promise<HTMLElement> {
  await user.click(
    within(rowOf(username)).getByRole("button", { name: `Actions for ${username}` }),
  );
  const menu = screen.getByRole("menu", { name: `Actions for ${username}` });
  await user.click(within(menu).getByRole("menuitem", { name: "Reset password" }));
  return screen.getByRole("dialog", { name: `Reset password for ${username}?` });
}

const TEMPORARY_PASSWORD = /^[a-z]+-[a-z]+-[a-z]+-\d{2}$/;

describe("Reset password", () => {
  it("confirms, sends a generated password, shows it once and lists the row as Temporary password", async () => {
    const random = vi.spyOn(crypto, "getRandomValues");
    const ines = fakeUser("ines");
    const api = installFakeApi({ users: [FAKE_ADMIN, ines] });
    const user = await openUsers();
    expect(within(rowOf("ines")).getByText("Active")).toBeInTheDocument();

    const confirm = await chooseReset(user, "ines");
    expect(confirm).toHaveTextContent(
      "ines is signed out everywhere and must choose a new password at next sign-in.",
    );
    expect(resets(api)).toEqual([]);
    await user.click(within(confirm).getByRole("button", { name: "Reset password" }));

    const done = await screen.findByRole("dialog", { name: "Password reset for ines" });
    const sent = resets(api);
    expect(sent).toEqual([
      {
        url: `/api/v1/admin/users/${ines.id}/reset-password`,
        body: { temp_password: expect.stringMatching(TEMPORARY_PASSWORD) as unknown },
      },
    ]);
    expect(random).toHaveBeenCalled();
    const password = (sent[0]?.body as { temp_password: string }).temp_password;
    expect(within(done).getByText(password)).toBeInTheDocument();
    expect(
      within(done).getByText(
        "Shown once. Copy it now and pass it to ines yourself; tuk-tuk sends no email.",
      ),
    ).toBeInTheDocument();

    await user.click(within(done).getByRole("button", { name: "Copy" }));
    expect(await navigator.clipboard.readText()).toBe(password);
    await user.click(within(done).getByRole("button", { name: "Done" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(password)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(within(rowOf("ines")).getByText("Temporary password")).toBeInTheDocument();
    });
    expect(within(rowOf("ines")).getByRole("button", { name: "Actions for ines" })).toHaveFocus();
    expect(api.users.find((account) => account.id === ines.id)?.password).toBe(password);
  });

  it("keeps the password on screen until it is copied or confirmed: Done, Close and Escape wait", async () => {
    installFakeApi({ users: [FAKE_ADMIN, fakeUser("ines")] });
    const user = await openUsers();
    await user.click(
      within(await chooseReset(user, "ines")).getByRole("button", { name: "Reset password" }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Password reset for ines" });
    const password = within(dialog).getByText(TEMPORARY_PASSWORD).textContent ?? "";
    expect(within(dialog).getByRole("button", { name: "Copy" })).toHaveFocus();
    expect(within(dialog).getByRole("button", { name: "Done" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeDisabled();
    expect(within(dialog).queryByRole("button", { name: "Add another" })).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Password reset for ines" })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("checkbox", { name: "I have it" }));
    expect(within(dialog).getByRole("button", { name: "Done" })).toBeEnabled();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(password)).not.toBeInTheDocument();
    expect(within(rowOf("ines")).getByRole("button", { name: "Actions for ines" })).toHaveFocus();
  });

  it("does nothing when the confirm is cancelled", async () => {
    const api = installFakeApi({ users: [FAKE_ADMIN, fakeUser("ines")] });
    const user = await openUsers();

    const confirm = await chooseReset(user, "ines");
    expect(within(confirm).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(resets(api)).toEqual([]);
    expect(within(rowOf("ines")).getByText("Active")).toBeInTheDocument();
    expect(within(rowOf("ines")).getByRole("button", { name: "Actions for ines" })).toHaveFocus();
  });

  it("says on the row when the reset failed and leaves the row as it was", async () => {
    const ines = fakeUser("ines");
    const api = installFakeApi({ users: [FAKE_ADMIN, ines] });
    const passthrough = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/reset-password")) {
        return new Response(
          JSON.stringify({ error: { code: "internal_error", message: "Unavailable" } }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
      return passthrough(input as string, init);
    });
    const user = await openUsers();

    await user.click(
      within(await chooseReset(user, "ines")).getByRole("button", { name: "Reset password" }),
    );

    expect(await within(rowOf("ines")).findByRole("alert")).toHaveTextContent(
      "Couldn’t reset ines’s password. Try again.",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(TEMPORARY_PASSWORD)).not.toBeInTheDocument();
    expect(within(rowOf("ines")).getByText("Active")).toBeInTheDocument();
    expect(within(rowOf("ines")).getByRole("button", { name: "Actions for ines" })).toHaveFocus();
    expect(api.users.find((account) => account.id === ines.id)?.must_change_password).toBe(false);
  });
});

describe("Reset password by keyboard", () => {
  it("is the menu's first entry; Escape on the confirm returns focus to the row's menu button", async () => {
    const api = installFakeApi({ users: [FAKE_ADMIN, fakeUser("ines")] });
    const user = await openUsers();
    const trigger = within(rowOf("ines")).getByRole("button", { name: "Actions for ines" });

    trigger.focus();
    await user.keyboard("{Enter}");
    const menu = screen.getByRole("menu", { name: "Actions for ines" });
    expect(within(menu).getAllByRole("menuitem")[0]).toHaveAccessibleName("Reset password");
    expect(within(menu).getByRole("menuitem", { name: "Reset password" })).toHaveFocus();
    await user.keyboard("{Enter}");

    const confirm = screen.getByRole("dialog", { name: "Reset password for ines?" });
    expect(within(confirm).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(resets(api)).toEqual([]);
  });
});

describe("Resetting your own password", () => {
  it("shows the new password until Done, then signs you out to sign in with it", async () => {
    const api = installFakeApi({ loggedIn: true, users: [FAKE_ADMIN, fakeUser("ines")] });
    const user = await openUsers(<AuthGate />);

    const confirm = await chooseReset(user, "admin");
    expect(confirm).toHaveTextContent(
      "You are signed out everywhere, here included, and must choose a new password at next sign-in.",
    );
    await user.click(within(confirm).getByRole("button", { name: "Reset password" }));

    const done = await screen.findByRole("dialog", { name: "Password reset for admin" });
    const password = within(done).getByText(TEMPORARY_PASSWORD).textContent ?? "";
    expect(resets(api)).toEqual([
      {
        url: `/api/v1/admin/users/${FAKE_ADMIN.id}/reset-password`,
        body: { temp_password: password },
      },
    ]);
    await user.click(within(done).getByRole("button", { name: "Copy" }));
    expect(screen.getByRole("table", { name: "Users" })).toBeInTheDocument();
    await user.click(within(done).getByRole("button", { name: "Done" }));

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Users" })).not.toBeInTheDocument();
    expect(screen.queryByText(password)).not.toBeInTheDocument();
  });
});

describe("The fake admin users API on reset", () => {
  it("records when the password changed and keeps that out of the admin record", async () => {
    const ines = fakeUser("ines");
    const api = installFakeApi({ users: [FAKE_ADMIN, ines] });
    const before = api.users.find((account) => account.id === ines.id)?.password_changed_at;

    const record = await resetAdminUserPassword(ines.id, generateTemporaryPassword());

    expect(record).toMatchObject({ id: ines.id, must_change_password: true });
    expect(record).not.toHaveProperty("password_changed_at");
    const stored = api.users.find((account) => account.id === ines.id);
    expect(stored?.password_changed_at).not.toBe(before);
    expect(Date.parse(stored?.password_changed_at ?? "")).not.toBeNaN();
  });
});
