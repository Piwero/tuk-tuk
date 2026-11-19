import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { FAKE_ADMIN, type FakeApiState, fakeUser, installFakeApi } from "./test/fakeApi";

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
    expect(window.location.pathname).toBe("/settings/account");
    expect(await screen.findByLabelText("Username")).toHaveValue("admin");
    expect(screen.getByLabelText("Email")).toHaveValue("admin@example.com");
  });

  it("gives an Admin a Users tab at its own URL, and Back returns to My account", async () => {
    installFakeApi();
    const user = await openSettings();

    await user.click(await screen.findByRole("link", { name: "Users" }));

    expect(window.location.pathname).toBe("/settings/users");
    expect(screen.getByRole("link", { name: "Users" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();

    window.history.back();

    expect(await screen.findByLabelText("Username")).toHaveValue("admin");
    expect(window.location.pathname).toBe("/settings/account");
  });

  it("opens the Users URL directly for an Admin", async () => {
    installFakeApi();
    window.history.replaceState(null, "", "/settings/users");

    render(<App />);

    expect(await screen.findByRole("link", { name: "Users" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(window.location.pathname).toBe("/settings/users");
  });

  it("shows a Member no Users tab, and their Users URL resolves to My account", async () => {
    const member = fakeUser("bea");
    installFakeApi({ users: [FAKE_ADMIN, member], sessionUserId: member.id });
    window.history.replaceState(null, "", "/settings/users");

    render(<App />);

    expect(await screen.findByLabelText("Username")).toHaveValue("bea");
    expect(window.location.pathname).toBe("/settings/account");
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
    expect(window.location.pathname).toBe("/settings/account");
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
    ["Username", "   ", "Username must be 1 to 64 characters."],
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
