import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { FAKE_ADMIN, type FakeApiState, fakeUser, installFakeApi } from "./test/fakeApi";

/** Settings › Users › New user (#479): an Admin creates an account and is
 * shown its temporary password once. Rendered against the fake API, signed
 * in as FAKE_ADMIN unless a test seeds its own `users`. */

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

async function openUsers(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "Account menu" }));
  await user.click(screen.getByRole("menuitem", { name: "Users" }));
  await screen.findByRole("table", { name: "Users" });
  return user;
}

/** The body row whose row header names `username`, as perceived text. */
function rowFor(username: string): HTMLElement | undefined {
  const table = screen.getByRole("table", { name: "Users" });
  return within(table)
    .getAllByRole("row")
    .find((row) => {
      const header = within(row).queryByRole("rowheader");
      return header?.textContent?.includes(username) ?? false;
    });
}

function creates(api: FakeApiState): Record<string, unknown>[] {
  return api.requests
    .filter((r) => r.method === "POST" && r.url === "/api/v1/admin/users")
    .map((r) => r.body as Record<string, unknown>);
}

const TEMPORARY_PASSWORD = /^[a-z]+-[a-z]+-[a-z]+-\d{2}$/;

describe("New user", () => {
  it("creates the account with a generated password shown once, and lists it as Temporary password", async () => {
    const random = vi.spyOn(crypto, "getRandomValues");
    const api = installFakeApi();
    const user = await openUsers();

    await user.click(screen.getByRole("button", { name: "New user" }));
    const form = screen.getByRole("dialog", { name: "New user" });
    expect(within(form).getByLabelText("Username")).toHaveFocus();
    expect(within(form).getByLabelText("Email")).toHaveAccessibleDescription(
      "Kept for password resets later. tuk-tuk sends no email.",
    );
    expect(within(form).getByRole("switch", { name: "Administrator" })).not.toBeChecked();
    // The admin never types a password.
    expect(within(form).queryByLabelText(/password/i)).not.toBeInTheDocument();

    await user.type(within(form).getByLabelText("Username"), "tomas");
    await user.type(within(form).getByLabelText("Email"), "tomas@example.org");
    await user.click(within(form).getByRole("button", { name: "Create user" }));

    const done = await screen.findByRole("dialog", { name: "User created" });
    const sent = creates(api);
    expect(sent).toEqual([
      {
        username: "tomas",
        email: "tomas@example.org",
        is_admin: false,
        temp_password: expect.stringMatching(TEMPORARY_PASSWORD) as unknown,
      },
    ]);
    expect(random).toHaveBeenCalled();
    const password = sent[0]?.temp_password as string;
    expect(within(done).getByText(password)).toBeInTheDocument();
    expect(
      within(done).getByText(
        "Shown once. Copy it now and pass it to tomas yourself; tuk-tuk sends no email.",
      ),
    ).toBeInTheDocument();
    expect(
      within(done).getByText(
        "At first sign-in they must choose a new password before anything else.",
      ),
    ).toBeInTheDocument();

    await user.click(within(done).getByRole("button", { name: "Copy" }));
    await user.click(within(done).getByRole("button", { name: "Done" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(password)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "2 users" })).toBeInTheDocument();
    expect(rowFor("tomas")).toHaveTextContent("Temporary password");
    expect(screen.getByRole("button", { name: "New user" })).toHaveFocus();
  });

  it("keeps the password on screen until it is copied: Done, Escape and Close wait for Copy", async () => {
    installFakeApi();
    const user = await openUsers();
    await createUser(user, "tomas", "tomas@example.org");

    const dialog = screen.getByRole("dialog", { name: "User created" });
    const password = within(dialog).getByText(TEMPORARY_PASSWORD).textContent ?? "";
    expect(within(dialog).getByRole("button", { name: "Done" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Add another" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeDisabled();

    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "User created" })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Copy" }));

    expect(await navigator.clipboard.readText()).toBe(password);
    expect(within(dialog).getByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Done" })).toBeEnabled();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(password)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New user" })).toHaveFocus();
  });

  it("lets an Admin who saved the password another way confirm they have it, then close", async () => {
    installFakeApi();
    const user = await openUsers();
    await createUser(user, "tomas", "tomas@example.org");

    const dialog = screen.getByRole("dialog", { name: "User created" });
    await user.click(within(dialog).getByRole("checkbox", { name: "I have it" }));
    expect(within(dialog).getByRole("button", { name: "Done" })).toBeEnabled();

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Add another returns to an empty form, and each account gets its own password", async () => {
    const api = installFakeApi();
    const user = await openUsers();
    await createUser(user, "tomas", "tomas@example.org");

    let dialog = screen.getByRole("dialog", { name: "User created" });
    await user.click(within(dialog).getByRole("button", { name: "Copy" }));
    await user.click(within(dialog).getByRole("button", { name: "Add another" }));

    const form = screen.getByRole("dialog", { name: "New user" });
    expect(within(form).getByLabelText("Username")).toHaveValue("");
    expect(within(form).getByLabelText("Username")).toHaveFocus();
    expect(within(form).getByLabelText("Email")).toHaveValue("");
    await user.type(within(form).getByLabelText("Username"), "ines");
    await user.type(within(form).getByLabelText("Email"), "ines@example.org");
    await user.click(within(form).getByRole("switch", { name: "Administrator" }));
    await user.click(within(form).getByRole("button", { name: "Create user" }));

    dialog = await screen.findByRole("dialog", { name: "User created" });
    const [first, second] = creates(api);
    expect(second).toMatchObject({ username: "ines", email: "ines@example.org", is_admin: true });
    expect(second?.temp_password).toMatch(TEMPORARY_PASSWORD);
    expect(second?.temp_password).not.toBe(first?.temp_password);
    expect(within(dialog).getByText(second?.temp_password as string)).toBeInTheDocument();
    expect(screen.queryByText(first?.temp_password as string)).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Copy" }));
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(screen.getByRole("heading", { name: "3 users" })).toBeInTheDocument();
    expect(rowFor("tomas")).toHaveTextContent("Member");
    expect(rowFor("ines")).toHaveTextContent("Admin");
    expect(rowFor("ines")).toHaveTextContent("Temporary password");
  });

  it("reports a taken username or email on its own field, keeping what was typed", async () => {
    const api = installFakeApi({
      users: [FAKE_ADMIN, fakeUser("tomas", { email: "tomas@example.org" })],
    });
    const user = await openUsers();

    await user.click(screen.getByRole("button", { name: "New user" }));
    const form = screen.getByRole("dialog", { name: "New user" });
    const username = within(form).getByLabelText("Username");
    const email = within(form).getByLabelText("Email");
    await user.type(username, "Tomas");
    await user.type(email, "new@example.org");
    await user.click(within(form).getByRole("button", { name: "Create user" }));

    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "That username is already taken.",
    );
    expect(username).toHaveAttribute("aria-invalid", "true");
    expect(username).toHaveAccessibleDescription("That username is already taken.");
    expect(username).toHaveFocus();
    expect(username).toHaveValue("Tomas");
    expect(email).toHaveValue("new@example.org");
    expect(email).not.toHaveAttribute("aria-invalid");

    await user.clear(username);
    await user.type(username, "tomas2");
    await user.clear(email);
    await user.type(email, "TOMAS@example.org");
    await user.click(within(form).getByRole("button", { name: "Create user" }));

    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "That email is already in use.",
    );
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveFocus();
    expect(username).not.toHaveAttribute("aria-invalid");
    expect(username).toHaveValue("tomas2");
    expect(creates(api)).toHaveLength(2);
    expect(screen.queryByRole("dialog", { name: "User created" })).not.toBeInTheDocument();
  });

  it("catches an empty username and an invalid email before submitting", async () => {
    const api = installFakeApi();
    const user = await openUsers();

    await user.click(screen.getByRole("button", { name: "New user" }));
    const form = screen.getByRole("dialog", { name: "New user" });
    const username = within(form).getByLabelText("Username");
    const email = within(form).getByLabelText("Email");
    await user.type(username, "   ");
    await user.type(email, "not-an-email");
    await user.click(within(form).getByRole("button", { name: "Create user" }));

    expect(username).toHaveAccessibleDescription("Enter a username of 1 to 64 characters.");
    expect(email).toHaveAccessibleDescription(
      "Kept for password resets later. tuk-tuk sends no email. Enter a valid email address.",
    );
    expect(username).toHaveFocus();
    expect(email).toHaveValue("not-an-email");
    expect(creates(api)).toEqual([]);
  });

  it("traps focus in the dialog and Cancel returns it to New user", async () => {
    const api = installFakeApi();
    const user = await openUsers();

    await user.click(screen.getByRole("button", { name: "New user" }));
    const form = screen.getByRole("dialog", { name: "New user" });
    for (let i = 0; i < 8; i += 1) {
      await user.tab();
      expect(form).toContainElement(document.activeElement as HTMLElement);
    }

    await user.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New user" })).toHaveFocus();
    expect(creates(api)).toEqual([]);
  });

  it("selects the password for copying by hand when the clipboard refuses, and still waits", async () => {
    installFakeApi();
    const user = await openUsers();
    await createUser(user, "tomas", "tomas@example.org");
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));

    const dialog = screen.getByRole("dialog", { name: "User created" });
    const password = within(dialog).getByText(TEMPORARY_PASSWORD);
    await user.click(within(dialog).getByRole("button", { name: "Copy" }));

    expect(window.getSelection()?.toString()).toBe(password.textContent);
    expect(within(dialog).getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Done" })).toBeDisabled();
  });

  it("keeps focus inside the dialog once the password is shown", async () => {
    installFakeApi();
    const user = await openUsers();
    await createUser(user, "tomas", "tomas@example.org");

    const dialog = screen.getByRole("dialog", { name: "User created" });
    expect(within(dialog).getByRole("button", { name: "Copy" })).toHaveFocus();
    for (let i = 0; i < 6; i += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });
});

async function createUser(
  user: ReturnType<typeof userEvent.setup>,
  username: string,
  email: string,
): Promise<void> {
  await user.click(screen.getByRole("button", { name: "New user" }));
  const form = screen.getByRole("dialog", { name: "New user" });
  await user.type(within(form).getByLabelText("Username"), username);
  await user.type(within(form).getByLabelText("Email"), email);
  await user.click(within(form).getByRole("button", { name: "Create user" }));
  await screen.findByRole("dialog", { name: "User created" });
}
