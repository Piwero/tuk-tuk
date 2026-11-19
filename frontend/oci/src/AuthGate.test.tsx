import { act, render, screen, waitFor, within } from "@testing-library/react";
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
    // The field can be found a moment before the focus effect has run.
    await waitFor(() => expect(loginField).toHaveFocus());
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

  it("tells a person whose account predates usernames to sign in as admin", async () => {
    installFakeApi({ loggedIn: false });

    render(<AuthGate />);

    expect(
      await screen.findByText(
        "Set up before usernames? Sign in as admin with your existing password.",
      ),
    ).toBeInTheDocument();
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
  const PENDING_STEPS = [
    ["a temporary password", { must_change_password: true }, "Choose a new password"],
    ["a profile to complete", { must_complete_profile: true }, "Complete your profile"],
  ] as const;

  it.each(PENDING_STEPS)(
    "with %s, keeps the app out of reach at any URL",
    async (_case, flags, stepHeading) => {
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
    },
  );

  it.each(
    [
      "/",
      "/today",
      "/all",
      "/settings",
      "/calendar/month",
      "/lists/1/kanban",
      "/tags/1",
      "/habits",
      "/assistant",
      "/no-such-page",
    ].flatMap((path) => PENDING_STEPS.map((step) => [step[0], path, step[1], step[2]] as const)),
  )(
    "with %s, shows only the step at %s and asks for no app data",
    async (_case, path, flags, stepHeading) => {
      const api = installFakeApi({
        loggedIn: true,
        users: [fakeUser("tomas", flags)],
        tasks: [fakeTask("Buy milk")],
      });
      window.history.replaceState(null, "", path);

      render(<AuthGate />);

      expect(await screen.findByRole("heading", { name: stepHeading })).toBeInTheDocument();
      // Moving through history while the step is up changes nothing either.
      window.history.pushState(null, "", "/settings");
      act(() => window.dispatchEvent(new PopStateEvent("popstate")));
      expect(screen.getByRole("heading", { name: stepHeading })).toBeInTheDocument();
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(screen.queryByText("Buy milk")).not.toBeInTheDocument();
      expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
      expect(api.requests.every((r) => r.url.startsWith("/api/v1/auth/"))).toBe(true);
    },
  );

  it("takes a person signing in with a temporary password straight to the step, saying why", async () => {
    installFakeApi({
      loggedIn: false,
      users: [fakeUser("tomas", { password: "temporary-pass", must_change_password: true })],
      tasks: [fakeTask("Buy milk")],
    });
    const user = userEvent.setup();
    render(<AuthGate />);

    await signIn(user, "tomas", "temporary-pass");

    expect(
      await screen.findByRole("heading", { name: "Choose a new password" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/you signed in with a temporary password/i)).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toHaveFocus();
    expect(screen.getByLabelText("Confirm new password")).toBeInTheDocument();
    expect(screen.getByText("Signed in as tomas")).toBeInTheDocument();
    expect(screen.queryByText("Buy milk")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("ticks a checklist as the person types and holds the button until both rules pass", async () => {
    installFakeApi({
      loggedIn: true,
      users: [fakeUser("tomas", { must_change_password: true })],
    });
    const user = userEvent.setup();
    render(<AuthGate />);

    const rules = await screen.findByRole("list", { name: "Password requirements" });
    const rule = (name: string): string =>
      within(rules)
        .getAllByRole("listitem")
        .map((item) => item.textContent ?? "")
        .find((text) => text.startsWith(name)) ?? "";
    const save = screen.getByRole("button", { name: "Save and continue" });
    expect(rule("At least 12 characters")).toMatch(/not yet/);
    expect(rule("Both entries match")).toMatch(/not yet/);
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText("New password"), "a-long-new-password");
    expect(rule("At least 12 characters")).toMatch(/done/);
    expect(rule("Both entries match")).toMatch(/not yet/);
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText("Confirm new password"), "a-long-new-passwor");
    expect(rule("Both entries match")).toMatch(/not yet/);
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText("Confirm new password"), "d");
    expect(rule("At least 12 characters")).toMatch(/done/);
    expect(rule("Both entries match")).toMatch(/done/);
    expect(save).toBeEnabled();
  });

  it("replaces the temporary password and lands on Today", async () => {
    const api = installFakeApi({
      loggedIn: true,
      users: [fakeUser("tomas", { password: "temporary-pass", must_change_password: true })],
      tasks: [fakeTask("Buy milk")],
    });
    window.history.replaceState(null, "", "/calendar/week");
    const user = userEvent.setup();
    render(<AuthGate />);

    await user.type(await screen.findByLabelText("New password"), "a-long-new-password");
    await user.type(screen.getByLabelText("Confirm new password"), "a-long-new-password{Enter}");

    expect(await screen.findByRole("heading", { name: "Today", level: 1 })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/today");
    expect(screen.queryByRole("heading", { name: "Choose a new password" })).toBeNull();
    expect(api.requests).toContainEqual({
      method: "POST",
      url: "/api/v1/auth/complete",
      body: { new_password: "a-long-new-password" },
    });
    expect(api.users[0]).toMatchObject({
      password: "a-long-new-password",
      must_change_password: false,
    });
  });

  it("reports on the field a new password the server rejects as the temporary one", async () => {
    const api = installFakeApi({
      loggedIn: true,
      users: [fakeUser("tomas", { password: "temporary-pass", must_change_password: true })],
      tasks: [fakeTask("Buy milk")],
    });
    const user = userEvent.setup();
    render(<AuthGate />);

    await user.type(await screen.findByLabelText("New password"), "temporary-pass");
    await user.type(screen.getByLabelText("Confirm new password"), "temporary-pass{Enter}");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/different from your temporary password/i);
    const field = screen.getByLabelText("New password");
    expect(field).toBeInvalid();
    expect(field).toHaveAccessibleDescription(alert.textContent ?? "");
    expect(field).toHaveFocus();
    expect(screen.getByRole("heading", { name: "Choose a new password" })).toBeInTheDocument();
    expect(screen.queryByText("Buy milk")).not.toBeInTheDocument();
    expect(api.users[0]?.must_change_password).toBe(true);
  });

  it.each(PENDING_STEPS)("lets the person log out from the step with %s", async (_case, flags) => {
    const api = installFakeApi({ loggedIn: true, users: [fakeUser("tomas", flags)] });
    const user = userEvent.setup();
    render(<AuthGate />);

    expect(await screen.findByText("One step before you start")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Log out" }));

    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(api.loggedIn).toBe(false);
  });
});

describe("AuthGate profile to complete", () => {
  /** The upgraded single user as migration 0035 seeds them: user #1, named
   * "admin", no email, an Admin, with the password they already had. */
  function upgradedAdmin(): ReturnType<typeof fakeUser> {
    return fakeUser("admin", {
      email: null,
      is_admin: true,
      password: "existing-password",
      must_complete_profile: true,
    });
  }

  it("takes the upgraded user signing in as admin to the step, saying nothing was lost", async () => {
    installFakeApi({ loggedIn: false, users: [upgradedAdmin()], tasks: [fakeTask("Buy milk")] });
    const user = userEvent.setup();
    render(<AuthGate />);

    await signIn(user, "admin", "existing-password");

    expect(
      await screen.findByRole("heading", { name: "Complete your profile" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/your tasks and settings are untouched/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Username")).toHaveFocus());
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(
      "Stored for password resets later. Nothing is sent yet.",
    );
    expect(screen.getByLabelText("New password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm new password")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Password requirements" })).toBeInTheDocument();
    expect(screen.getByText("Signed in with your existing password")).toBeInTheDocument();
    expect(screen.queryByText("Buy milk")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  async function fillProfile(
    user: ReturnType<typeof userEvent.setup>,
    { username, email, password }: { username: string; email: string; password: string },
  ): Promise<void> {
    const usernameField = await screen.findByLabelText("Username");
    if (username) await user.type(usernameField, username);
    if (email) await user.type(screen.getByLabelText("Email"), email);
    await user.type(screen.getByLabelText("New password"), password);
    await user.type(screen.getByLabelText("Confirm new password"), `${password}{Enter}`);
  }

  it("saves username, email and new password together, then lands on Today as an admin", async () => {
    const api = installFakeApi({ loggedIn: true, users: [upgradedAdmin()] });
    window.history.replaceState(null, "", "/calendar/week");
    const user = userEvent.setup();
    render(<AuthGate />);

    await fillProfile(user, {
      username: "rafa",
      email: "rafa@example.org",
      password: "a-long-new-password",
    });

    expect(await screen.findByRole("heading", { name: "Today", level: 1 })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/today");
    expect(screen.queryByRole("heading", { name: "Complete your profile" })).toBeNull();
    expect(api.requests).toContainEqual({
      method: "POST",
      url: "/api/v1/auth/complete",
      body: { new_password: "a-long-new-password", username: "rafa", email: "rafa@example.org" },
    });
    expect(api.users[0]).toMatchObject({
      username: "rafa",
      email: "rafa@example.org",
      password: "a-long-new-password",
      is_admin: true,
      must_complete_profile: false,
      must_change_password: false,
    });
  });

  it.each([
    [
      "a username someone else has",
      { username: "BEA", email: "rafa@example.org", password: "a-long-new-password" },
      "Username",
      /username is already taken/i,
    ],
    [
      "an email someone else has",
      { username: "rafa", email: "bea@example.com", password: "a-long-new-password" },
      "Email",
      /email is already in use/i,
    ],
    [
      "the password they already had",
      { username: "rafa", email: "rafa@example.org", password: "existing-password" },
      "New password",
      /different from your current password/i,
    ],
  ])("reports %s on its field and keeps the step", async (_case, fields, fieldLabel, message) => {
    const api = installFakeApi({
      loggedIn: true,
      users: [upgradedAdmin(), fakeUser("bea")],
      tasks: [fakeTask("Buy milk")],
    });
    const user = userEvent.setup();
    render(<AuthGate />);

    await fillProfile(user, fields);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    const field = screen.getByLabelText(fieldLabel);
    expect(field).toBeInvalid();
    expect(field).toHaveAccessibleDescription(expect.stringContaining(alert.textContent ?? ""));
    expect(field).toHaveFocus();
    expect(screen.getByRole("heading", { name: "Complete your profile" })).toBeInTheDocument();
    expect(screen.queryByText("Buy milk")).not.toBeInTheDocument();
    expect(api.users[0]).toMatchObject({ username: "admin", must_complete_profile: true });
  });

  it.each([
    ["an empty username", { username: "", email: "rafa@example.org" }, "Username", /username/i],
    ["an invalid email", { username: "rafa", email: "rafa.example.org" }, "Email", /valid email/i],
  ])("catches %s on its field before submitting", async (_case, fields, fieldLabel, message) => {
    const api = installFakeApi({ loggedIn: true, users: [upgradedAdmin()] });
    const user = userEvent.setup();
    render(<AuthGate />);

    await fillProfile(user, { ...fields, password: "a-long-new-password" });

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText(fieldLabel)).toBeInvalid();
    expect(screen.getByLabelText(fieldLabel)).toHaveFocus();
    expect(api.requests.some((r) => r.url === "/api/v1/auth/complete")).toBe(false);
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
