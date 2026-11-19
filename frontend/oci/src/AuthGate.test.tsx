import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AuthGate } from "./AuthGate";
import { ApiError, fetchLists, setup } from "./api";
import { FAKE_PASSWORD, fakeTask, fakeUser, installFakeApi } from "./test/fakeApi";

async function signIn(
  user: ReturnType<typeof userEvent.setup>,
  loginName: string,
  password: string,
): Promise<void> {
  await user.type(await screen.findByLabelText("Username or email"), loginName);
  await user.type(screen.getByLabelText("Password"), `${password}{Enter}`);
}

describe("AuthGate sign-in", () => {
  it("signs in by username from the first field, with Enter submitting", async () => {
    const api = installFakeApi({ loggedIn: false, tasks: [fakeTask("Buy milk")] });
    const user = userEvent.setup();
    render(<AuthGate />);

    const loginField = await screen.findByLabelText("Username or email");
    expect(loginField).toHaveFocus();
    await user.type(loginField, "admin");
    await user.type(screen.getByLabelText("Password"), `${FAKE_PASSWORD}{Enter}`);

    expect(await screen.findByText("Buy milk")).toBeInTheDocument();
    expect(api.requests).toContainEqual({
      method: "POST",
      url: "/api/v1/auth/login",
      body: { login: "admin", password: FAKE_PASSWORD },
    });
  });

  it("signs in by email, ignoring capitalisation", async () => {
    installFakeApi({
      loggedIn: false,
      users: [fakeUser("bea", { email: "bea@example.com" })],
      tasks: [fakeTask("Buy milk")],
    });
    const user = userEvent.setup();
    render(<AuthGate />);

    await signIn(user, "Bea@Example.COM", FAKE_PASSWORD);

    expect(await screen.findByText("Buy milk")).toBeInTheDocument();
  });

  it("shows one announced message for a wrong password and for an unknown name", async () => {
    installFakeApi({ loggedIn: false, tasks: [fakeTask("Buy milk")] });
    const user = userEvent.setup();
    render(<AuthGate />);

    await signIn(user, "admin", "wrong-password");
    const wrongPassword = (await screen.findByRole("alert")).textContent;
    expect(screen.getByLabelText("Password")).toHaveAccessibleDescription(wrongPassword ?? "");
    expect(screen.getByLabelText("Password")).toHaveValue("");

    await user.clear(screen.getByLabelText("Username or email"));
    await signIn(user, "nobody", FAKE_PASSWORD);
    await screen.findByRole("alert");

    expect(wrongPassword).toBe("Incorrect username, email or password.");
    expect(screen.getByRole("alert")).toHaveTextContent(wrongPassword ?? "");
    expect(screen.queryByText("Buy milk")).not.toBeInTheDocument();
  });

  it("says sign-in is temporarily locked after too many attempts", async () => {
    installFakeApi({ loggedIn: false, loginLocked: true });
    const user = userEvent.setup();
    render(<AuthGate />);

    await signIn(user, "admin", FAKE_PASSWORD);

    expect(await screen.findByRole("alert")).toHaveTextContent(/too many attempts/i);
    expect(screen.getByLabelText("Username or email")).toBeInTheDocument();
  });

  it("tells a disabled account to contact the admin", async () => {
    installFakeApi({
      loggedIn: false,
      users: [fakeUser("bea", { is_active: false })],
      tasks: [fakeTask("Buy milk")],
    });
    const user = userEvent.setup();
    render(<AuthGate />);

    await signIn(user, "bea", FAKE_PASSWORD);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/disabled/i);
    expect(alert).toHaveTextContent(/contact your admin/i);
    expect(screen.queryByText("Buy milk")).not.toBeInTheDocument();
  });

  it("tells a person who forgot their password to ask the admin, with no reset link", async () => {
    installFakeApi({ loggedIn: false });

    render(<AuthGate />);

    expect(await screen.findByText(/forgot your password\? ask your admin/i)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows sign-in instead of the app without a session", async () => {
    installFakeApi({ loggedIn: false, tasks: [fakeTask("Buy milk")] });

    render(<AuthGate />);

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByText("Buy milk")).not.toBeInTheDocument();
  });

  it("renders the app directly when a session already exists", async () => {
    installFakeApi({ loggedIn: true, tasks: [fakeTask("Buy milk")] });

    render(<AuthGate />);

    expect(await screen.findByText("Buy milk")).toBeInTheDocument();
    expect(screen.queryByLabelText("Username or email")).not.toBeInTheDocument();
  });

  it("returns to sign-in when a later request reports the session ended", async () => {
    const api = installFakeApi({ loggedIn: true, tasks: [fakeTask("Buy milk")] });
    const user = userEvent.setup();
    render(<AuthGate />);
    expect(await screen.findByText("Buy milk")).toBeInTheDocument();

    // The session ends server-side (say, the password was changed on
    // another device), then a later request fails — the shared request
    // helper is what the app's own components go through.
    api.loggedIn = false;
    await act(() => expect(fetchLists()).rejects.toThrow());

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByText("Buy milk")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await signIn(user, "admin", FAKE_PASSWORD);
    expect(await screen.findByText("Buy milk")).toBeInTheDocument();
  });

  it("returns to sign-in with the disabled message when the account is disabled mid-session", async () => {
    const bea = fakeUser("bea");
    const api = installFakeApi({ loggedIn: true, users: [bea], tasks: [fakeTask("Buy milk")] });
    render(<AuthGate />);
    expect(await screen.findByText("Buy milk")).toBeInTheDocument();

    const account = api.users.find((candidate) => candidate.id === bea.id);
    if (account) account.is_active = false;
    await act(() => expect(fetchLists()).rejects.toThrow());

    expect(await screen.findByRole("alert")).toHaveTextContent(/disabled.*contact your admin/i);
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByText("Buy milk")).not.toBeInTheDocument();
  });

  it("returns to sign-in with no app content left after logging out", async () => {
    const api = installFakeApi({ loggedIn: true, tasks: [fakeTask("Buy milk")] });
    const user = userEvent.setup();
    render(<AuthGate />);
    expect(await screen.findByText("Buy milk")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "App menu" }));
    await user.click(await screen.findByLabelText("Log out"));

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByText("Buy milk")).not.toBeInTheDocument();
    expect(api.loggedIn).toBe(false);
  });
});

describe("AuthGate pending forced step", () => {
  it.each([
    ["a temporary password", { must_change_password: true }, "Choose a new password"],
    ["a profile to complete", { must_complete_profile: true }, "Complete your profile"],
  ])("with %s, keeps the app out of reach at any URL", async (_case, flags, stepHeading) => {
    installFakeApi({
      loggedIn: true,
      users: [fakeUser("tomas", flags)],
      tasks: [fakeTask("Buy milk")],
    });
    window.history.replaceState(null, "", "/calendar/week");

    render(<AuthGate />);

    expect(await screen.findByRole("heading", { name: stepHeading })).toBeInTheDocument();
    expect(screen.queryByText("Buy milk")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("lets the person log out from the step", async () => {
    const api = installFakeApi({
      loggedIn: true,
      users: [fakeUser("tomas", { must_change_password: true })],
    });
    const user = userEvent.setup();
    render(<AuthGate />);

    expect(await screen.findByText("Signed in as tomas")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Log out" }));

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(api.loggedIn).toBe(false);
  });
});

describe("AuthGate first-run setup", () => {
  async function fillSetup(
    user: ReturnType<typeof userEvent.setup>,
    { username, email, password }: { username: string; email: string; password: string },
  ): Promise<void> {
    const usernameField = await screen.findByLabelText("Username");
    if (username) await user.type(usernameField, username);
    if (email) await user.type(screen.getByLabelText("Email"), email);
    await user.type(screen.getByLabelText("Password"), `${password}{Enter}`);
  }

  it("asks the first visitor to create the admin account, saying it manages the others", async () => {
    installFakeApi({ loggedIn: false, users: [], tasks: [fakeTask("Buy milk")] });

    render(<AuthGate />);

    expect(
      await screen.findByRole("heading", { name: "Create the admin account" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/the first account manages the others/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toHaveFocus();
    expect(screen.queryByText("Buy milk")).not.toBeInTheDocument();
  });

  it("states the 12-character minimum on the password field before typing", async () => {
    installFakeApi({ loggedIn: false, users: [] });

    render(<AuthGate />);

    expect(await screen.findByLabelText("Password")).toHaveAccessibleDescription(
      /at least 12 characters/i,
    );
  });

  it("creates the admin from username, email and password, then lands on Today", async () => {
    const api = installFakeApi({ loggedIn: false, users: [] });
    window.history.replaceState(null, "", "/calendar/week");
    const user = userEvent.setup();
    render(<AuthGate />);

    await fillSetup(user, {
      username: "rafa",
      email: "rafa@example.org",
      password: "a-long-new-password",
    });

    expect(await screen.findByRole("heading", { name: "Today", level: 1 })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/today");
    expect(api.requests).toContainEqual({
      method: "POST",
      url: "/api/v1/auth/setup",
      body: { username: "rafa", email: "rafa@example.org", password: "a-long-new-password" },
    });
    expect(api.users).toEqual([
      expect.objectContaining({ username: "rafa", email: "rafa@example.org", is_admin: true }),
    ]);
  });

  it.each([
    ["an empty username", { username: "", email: "rafa@example.org" }, "Username", /username/i],
    ["an invalid email", { username: "rafa", email: "rafa.example.org" }, "Email", /valid email/i],
  ])("catches %s before submitting", async (_case, fields, fieldLabel, message) => {
    const api = installFakeApi({ loggedIn: false, users: [] });
    const user = userEvent.setup();
    render(<AuthGate />);

    await fillSetup(user, { ...fields, password: "a-long-new-password" });

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText(fieldLabel)).toBeInvalid();
    expect(screen.getByLabelText(fieldLabel)).toHaveFocus();
    expect(api.requests.some((r) => r.url === "/api/v1/auth/setup")).toBe(false);
  });

  it("catches a too-short password before submitting", async () => {
    const api = installFakeApi({ loggedIn: false, users: [] });
    const user = userEvent.setup();
    render(<AuthGate />);

    await fillSetup(user, { username: "rafa", email: "rafa@example.org", password: "short" });

    expect(await screen.findByRole("alert")).toHaveTextContent(/12 characters/);
    expect(screen.getByLabelText("Password")).toBeInvalid();
    expect(api.requests.some((r) => r.url === "/api/v1/auth/setup")).toBe(false);
  });

  it("shows sign-in, not setup, at the setup URL once a user exists", async () => {
    installFakeApi({ loggedIn: false });
    window.history.replaceState(null, "", "/setup");

    render(<AuthGate />);

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Create the admin account" })).toBeNull();
  });

  it("falls back to sign-in when someone else finished setup first", async () => {
    const api = installFakeApi({ loggedIn: false, users: [] });
    const user = userEvent.setup();
    render(<AuthGate />);
    await screen.findByRole("heading", { name: "Create the admin account" });

    api.users.push(fakeUser("first", { is_admin: true }));
    await fillSetup(user, {
      username: "rafa",
      email: "rafa@example.org",
      password: "a-long-new-password",
    });

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(api.users).toHaveLength(1);
  });

  it("the fake /setup route applies the backend's validation", async () => {
    installFakeApi({ loggedIn: false, users: [] });

    await expect(
      setup({ username: "rafa", email: "rafa@example.org", password: "short" }),
    ).rejects.toSatisfy(
      (err: unknown) => err instanceof ApiError && err.code === "invalid_password",
    );
    await expect(
      setup({ username: "rafa", email: "no-at-sign", password: "a-long-new-password" }),
    ).rejects.toSatisfy((err: unknown) => err instanceof ApiError && err.code === "invalid_email");
    await expect(
      setup({ username: "  ", email: "rafa@example.org", password: "a-long-new-password" }),
    ).rejects.toSatisfy(
      (err: unknown) => err instanceof ApiError && err.code === "invalid_username",
    );
  });
});
