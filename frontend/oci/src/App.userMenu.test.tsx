import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "./App";
import { fakeUser, installFakeApi } from "./test/fakeApi";

/** The user menu (#473): an avatar at the top right of every view naming who
 * is signed in, holding My account, Users (admins only), Dark mode and Log
 * out. Rendered against the fake API, which signs in as FAKE_ADMIN unless a
 * test seeds its own `users`. */

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  window.history.replaceState(null, "", "/");
});

async function openAccountMenu(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(await screen.findByRole("button", { name: "Account menu" }));
  return screen.getByRole("menu", { name: "Account menu" });
}

describe("User menu", () => {
  it("shows the signed-in person's initial and names the account by username and email", async () => {
    installFakeApi({ users: [fakeUser("rafa", { email: "rafa@example.org" })] });
    const user = userEvent.setup();
    render(<App />);

    const avatar = await screen.findByRole("button", { name: "Account menu" });
    expect(await within(avatar).findByText("R")).toBeInTheDocument();

    await openAccountMenu(user);
    expect(screen.getByText("rafa")).toBeInTheDocument();
    expect(screen.getByText("rafa@example.org")).toBeInTheDocument();
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });

  it.each([
    ["Today", "/today"],
    ["Calendar", "/calendar/week"],
    ["Habits", "/habits"],
    ["Settings", "/settings"],
  ])("is on the %s view", async (_view, path) => {
    installFakeApi();
    window.history.replaceState(null, "", path);
    render(<App />);

    expect(await screen.findByRole("button", { name: "Account menu" })).toBeInTheDocument();
  });

  it("marks an admin with an Admin badge and offers Users, which opens Settings › Users", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);

    const menu = await openAccountMenu(user);
    expect(screen.getByText("Admin")).toBeInTheDocument();
    await user.click(within(menu).getByRole("menuitem", { name: "Users" }));

    expect(window.location.pathname).toBe("/settings/users");
    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByRole("menu", { name: "Account menu" })).not.toBeInTheDocument();
  });

  it("offers a Member no Users entry", async () => {
    installFakeApi({ users: [fakeUser("bea")] });
    const user = userEvent.setup();
    render(<App />);

    const menu = await openAccountMenu(user);
    expect(within(menu).getByRole("menuitem", { name: "My account" })).toBeInTheDocument();
    expect(within(menu).queryByRole("menuitem", { name: "Users" })).not.toBeInTheDocument();
  });

  it("opens Settings › My account from My account", async () => {
    installFakeApi({ users: [fakeUser("bea")] });
    const user = userEvent.setup();
    render(<App />);

    const menu = await openAccountMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: "My account" }));

    expect(window.location.pathname).toBe("/settings/account");
    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
  });

  it("names the account by its new username after a rename in My account", async () => {
    installFakeApi({ users: [fakeUser("bea")] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      within(await openAccountMenu(user)).getByRole("menuitem", { name: "My account" }),
    );

    const username = await screen.findByLabelText("Username");
    await user.clear(username);
    await user.type(username, "beatriz{Enter}");
    await screen.findByText("Username saved.");

    const avatar = screen.getByRole("button", { name: "Account menu" });
    await openAccountMenu(user);
    expect(screen.getByText("beatriz")).toBeInTheDocument();
    expect(within(avatar).getByText("B")).toBeInTheDocument();
  });

  it("opens with Enter or Space, moves with the arrow keys and returns focus on Escape", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App onLogout={() => undefined} />);
    const avatar = await screen.findByRole("button", { name: "Account menu" });

    avatar.focus();
    await user.keyboard("{Enter}");
    const menu = screen.getByRole("menu", { name: "Account menu" });
    const item = (name: string): HTMLElement =>
      within(menu).getByRole(name === "Dark mode" ? "menuitemcheckbox" : "menuitem", { name });
    expect(item("My account")).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(item("Users")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(item("Dark mode")).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(item("Users")).toHaveFocus();
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(item("Log out")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(item("My account")).toHaveFocus();
    await user.keyboard("{End}");
    expect(item("Log out")).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "Account menu" })).not.toBeInTheDocument();
    expect(avatar).toHaveFocus();

    await user.keyboard(" ");
    expect(screen.getByRole("menu", { name: "Account menu" })).toBeInTheDocument();
  });
});
