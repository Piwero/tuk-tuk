import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { ApiError, changePassword } from "./api";
import {
  FAKE_ADMIN,
  FAKE_PASSWORD,
  type FakeApiState,
  fakeUser,
  installFakeApi,
} from "./test/fakeApi";

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

async function openSettings(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "Account menu" }));
  await user.click(screen.getByRole("menuitem", { name: "My account" }));
  return user;
}

describe("Settings tabs", () => {
  it("opens on My account, at its own URL, starting with the profile", async () => {
    installFakeApi();

    await openSettings();

    expect(await screen.findByRole("link", { name: "My account" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await waitFor(() => expect(window.location.pathname).toBe("/settings/account"));
    expect(await screen.findByLabelText("Username")).toHaveValue("admin");
    expect(screen.getByLabelText("Email")).toHaveValue("admin@example.com");
  });

  it("gives an Admin a Users tab at its own URL, and Back returns to My account", async () => {
    installFakeApi();
    const user = await openSettings();

    await user.click(await screen.findByRole("link", { name: "Users" }));

    await waitFor(() => expect(window.location.pathname).toBe("/settings/users"));
    expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();

    window.history.back();

    expect(await screen.findByLabelText("Username")).toHaveValue("admin");
    await waitFor(() => expect(window.location.pathname).toBe("/settings/account"));
  });

  it("opens the Users URL directly for an Admin", async () => {
    installFakeApi();
    window.history.replaceState(null, "", "/settings/users");

    render(<App />);

    expect(await screen.findByRole("link", { name: "Users" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await waitFor(() => expect(window.location.pathname).toBe("/settings/users"));
  });

  it("shows a Member no Users tab, and their Users URL resolves to My account", async () => {
    const member = fakeUser("bea");
    installFakeApi({ users: [FAKE_ADMIN, member], sessionUserId: member.id });
    window.history.replaceState(null, "", "/settings/users");

    render(<App />);

    expect(await screen.findByLabelText("Username")).toHaveValue("bea");
    await waitFor(() => expect(window.location.pathname).toBe("/settings/account"));
    expect(screen.getByRole("link", { name: "My account" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
  });

  it("resolves the bare /settings URL to My account", async () => {
    installFakeApi();
    window.history.replaceState(null, "", "/settings");

    render(<App />);

    expect(await screen.findByLabelText("Username")).toHaveValue("admin");
    await waitFor(() => expect(window.location.pathname).toBe("/settings/account"));
  });
});

describe("My account's existing settings", () => {
  it("follow the profile in their current order", async () => {
    installFakeApi({ googleConfigured: true });
    await openSettings();
    await screen.findByRole("region", { name: "Connections" });
    await screen.findByRole("region", { name: "AI helpers" });

    const order = [
      "Profile",
      "Appearance",
      "Features",
      "Active hours",
      "AI helpers",
      "Connections",
    ];
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent ?? "");
    expect(headings.filter((h) => order.includes(h))).toEqual(order);
  });

  it("shows a Member About but not the instance's Database settings", async () => {
    const member = fakeUser("bea");
    installFakeApi({ users: [FAKE_ADMIN, member], sessionUserId: member.id });
    window.history.replaceState(null, "", "/settings/account");

    render(<App />);

    expect(await screen.findByLabelText("Username")).toHaveValue("bea");
    expect(screen.getByRole("region", { name: "About" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Database" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Database" })).not.toBeInTheDocument();
  });

  it("shows an Admin the Database settings", async () => {
    installFakeApi();
    await openSettings();

    expect(await screen.findByRole("region", { name: "Database" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Database" })).toBeInTheDocument();
  });
});

function profileSaves(api: FakeApiState): unknown[] {
  return api.requests
    .filter((r) => r.method === "PATCH" && r.url === "/api/v1/auth/me")
    .map((r) => r.body);
}

describe("Profile", () => {
  it("saves a new username on its own", async () => {
    const api = installFakeApi();
    const user = await openSettings();
    const username = await screen.findByLabelText("Username");

    await user.clear(username);
    await user.type(username, "ines");
    await user.click(screen.getByRole("button", { name: "Save username" }));

    expect(await screen.findByText("Username saved.")).toBeInTheDocument();
    expect(profileSaves(api)).toEqual([{ username: "ines" }]);
    expect(api.users[0]?.username).toBe("ines");
    expect(username).toHaveValue("ines");
  });

  it("saves a new email on its own", async () => {
    const api = installFakeApi();
    const user = await openSettings();
    const email = await screen.findByLabelText("Email");

    await user.clear(email);
    await user.type(email, "ines@example.org{Enter}");

    expect(await screen.findByText("Email saved.")).toBeInTheDocument();
    expect(profileSaves(api)).toEqual([{ email: "ines@example.org" }]);
    expect(screen.getByLabelText("Username")).toHaveValue("admin");
  });

  it.each([
    ["Username", "BEA", "That username is already taken."],
    ["Email", "Bea@Example.com", "That email is already in use."],
  ])(
    "reports a %s another user holds on that field, keeping what was typed",
    async (label, taken, message) => {
      const api = installFakeApi({ users: [FAKE_ADMIN, fakeUser("bea")] });
      const user = await openSettings();
      const field = await screen.findByLabelText(label);

      await user.clear(field);
      await user.type(field, taken);
      await user.click(screen.getByRole("button", { name: `Save ${label.toLowerCase()}` }));

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(field).toHaveAccessibleDescription(message);
      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(field).toHaveValue(taken);
      expect(profileSaves(api)).toHaveLength(1);
      expect(api.users[0]).toMatchObject({ username: "admin", email: "admin@example.com" });
      const other = label === "Username" ? "Email" : "Username";
      expect(screen.getByLabelText(other)).not.toHaveAttribute("aria-invalid");
    },
  );

  it.each([
    ["Username", "   ", "Enter a username of 1 to 64 characters."],
    ["Email", "not-an-email", "Enter a valid email address."],
  ])(
    "catches an invalid %s on its field without asking the server",
    async (label, bad, message) => {
      const api = installFakeApi();
      const user = await openSettings();
      const field = await screen.findByLabelText(label);

      await user.clear(field);
      await user.type(field, bad);
      await user.click(screen.getByRole("button", { name: `Save ${label.toLowerCase()}` }));

      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(field).toHaveAccessibleDescription(message);
      expect(profileSaves(api)).toEqual([]);
    },
  );
});

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

describe("Password", () => {
  it("sits in the Profile card and says when the password last changed", async () => {
    installFakeApi({ users: [{ ...FAKE_ADMIN, password_changed_at: daysAgo(21) }] });
    await openSettings();

    const profile = await screen.findByRole("region", { name: "Profile" });

    expect(await within(profile).findByText("Changed 3 weeks ago")).toBeInTheDocument();
    expect(within(profile).getByRole("button", { name: "Change password" })).toBeInTheDocument();
  });

  it("opens a dialog asking for the current password, stating the minimum and the sign-out", async () => {
    installFakeApi();
    const user = await openSettings();

    await user.click(await screen.findByRole("button", { name: "Change password" }));

    const dialog = screen.getByRole("dialog", { name: "Change password" });
    expect(within(dialog).getByLabelText("Current password")).toHaveFocus();
    expect(within(dialog).getByLabelText("New password")).toHaveAccessibleDescription(
      "At least 12 characters.",
    );
    expect(within(dialog).getByLabelText("Confirm new password")).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      "Your other devices and sessions will be signed out. This one stays signed in.",
    );
  });

  it("changes the password, updates the row and keeps this session signed in", async () => {
    const api = installFakeApi({
      users: [{ ...FAKE_ADMIN, password_changed_at: daysAgo(21) }],
    });
    const user = await openSettings();
    const trigger = await screen.findByRole("button", { name: "Change password" });

    await user.click(trigger);
    await fillChangePassword(user, FAKE_PASSWORD, "a-brand-new-password");

    expect(await screen.findByText("Changed just now")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Password changed. Your other devices will need to sign in again.",
    );
    expect(trigger).toHaveFocus();
    expect(passwordChanges(api)).toEqual([
      { current_password: FAKE_PASSWORD, new_password: "a-brand-new-password" },
    ]);
    expect(screen.getByLabelText("Username")).toHaveValue("admin");
    expect(api.loggedIn).toBe(true);
  });

  it("refuses a wrong current password on its field and keeps the old one", async () => {
    const api = installFakeApi();
    const user = await openSettings();
    await user.click(await screen.findByRole("button", { name: "Change password" }));

    await fillChangePassword(user, "wrong-password", "a-brand-new-password");

    const dialog = screen.getByRole("dialog", { name: "Change password" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Current password is incorrect.",
    );
    expect(within(dialog).getByLabelText("Current password")).toHaveFocus();
    expect(api.users[0]?.password).toBe(FAKE_PASSWORD);
  });

  it.each([
    ["a too-short password", "short", "short", "Password must be at least 12 characters."],
    [
      "entries that don't match",
      "a-brand-new-password",
      "a-different-password",
      "New password and confirmation don't match.",
    ],
  ])("catches %s without asking the server", async (_case, next, confirm, message) => {
    const api = installFakeApi();
    const user = await openSettings();
    await user.click(await screen.findByRole("button", { name: "Change password" }));

    await fillChangePassword(user, FAKE_PASSWORD, next, confirm);

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(passwordChanges(api)).toEqual([]);
  });

  it("shows the lockout message when changing the password is locked", async () => {
    installFakeApi({ users: [{ ...FAKE_ADMIN, login_locked: true }] });
    const user = await openSettings();
    await user.click(await screen.findByRole("button", { name: "Change password" }));

    await fillChangePassword(user, FAKE_PASSWORD, "a-brand-new-password");

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts");
  });

  it("closes on Escape without a request and returns focus to its trigger", async () => {
    const api = installFakeApi();
    const user = await openSettings();
    const trigger = await screen.findByRole("button", { name: "Change password" });
    await user.click(trigger);
    await user.type(screen.getByLabelText("Current password"), FAKE_PASSWORD);

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(passwordChanges(api)).toEqual([]);
  });

  it("keeps Tab inside the dialog", async () => {
    installFakeApi();
    const user = await openSettings();
    await user.click(await screen.findByRole("button", { name: "Change password" }));
    const dialog = screen.getByRole("dialog", { name: "Change password" });

    for (let step = 0; step < 8; step += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("replaces the old Security section", async () => {
    installFakeApi();
    await openSettings();
    await screen.findByRole("region", { name: "Profile" });

    expect(screen.queryByRole("region", { name: "Security" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Security" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Change password" })).toHaveLength(1);
  });

  it("is backed by a fake /password route applying the backend's minimum", async () => {
    installFakeApi();

    await expect(changePassword(FAKE_PASSWORD, "short")).rejects.toSatisfy(
      (err: unknown) => err instanceof ApiError && err.code === "invalid_password",
    );
  });
});

function passwordChanges(api: FakeApiState): unknown[] {
  return api.requests
    .filter((r) => r.method === "POST" && r.url === "/api/v1/auth/password")
    .map((r) => r.body);
}

async function fillChangePassword(
  user: ReturnType<typeof userEvent.setup>,
  current: string,
  next: string,
  confirm: string = next,
): Promise<void> {
  const dialog = screen.getByRole("dialog", { name: "Change password" });
  await user.type(within(dialog).getByLabelText("Current password"), current);
  await user.type(within(dialog).getByLabelText("New password"), next);
  await user.type(within(dialog).getByLabelText("Confirm new password"), confirm);
  await user.click(within(dialog).getByRole("button", { name: "Change password" }));
}
