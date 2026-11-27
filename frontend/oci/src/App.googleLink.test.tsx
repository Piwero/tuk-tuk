import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { browserNavigation } from "./navigation";
import {
  FAKE_ADMIN,
  FAKE_GOOGLE_URL,
  FAKE_PASSWORD,
  fakeUser,
  installFakeApi,
} from "./test/fakeApi";

/** Settings › My account › Sign in with Google (#586): an existing account
 * links Google after confirming its password; an account already linked
 * says which Google account it uses. */

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

function renderAccount(path = "/settings/account"): ReturnType<typeof userEvent.setup> {
  window.history.replaceState(null, "", path);
  const user = userEvent.setup();
  render(<App />);
  return user;
}

async function googleSection(): Promise<HTMLElement> {
  return screen.findByRole("region", { name: "Sign in with Google" });
}

describe("Linking Google to an existing account (#586)", () => {
  it("confirms the password, then sends the browser to Google", async () => {
    const api = installFakeApi({ googleSignIn: true });
    const assign = vi.fn();
    vi.spyOn(browserNavigation, "assign").mockImplementation(assign);
    const user = renderAccount();

    const section = await googleSection();
    expect(within(section).getByText("Not linked")).toBeInTheDocument();
    await user.click(within(section).getByRole("button", { name: "Link Google account" }));
    const dialog = screen.getByRole("dialog", { name: "Link a Google account" });
    await user.type(within(dialog).getByLabelText("Current password"), `${FAKE_PASSWORD}{Enter}`);

    await vi.waitFor(() => expect(assign).toHaveBeenCalledWith(`${FAKE_GOOGLE_URL}?purpose=link`));
    expect(api.googleLinkStarts).toEqual([{ password: FAKE_PASSWORD, next: "/settings/account" }]);
  });

  it("keeps the dialog open on a wrong password", async () => {
    installFakeApi({ googleSignIn: true });
    const user = renderAccount();

    await user.click(
      within(await googleSection()).getByRole("button", { name: "Link Google account" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Link a Google account" });
    await user.type(within(dialog).getByLabelText("Current password"), "wrong{Enter}");

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Current password is incorrect.",
    );
  });

  it("says which Google account a linked User signs in with, and leaves the email to an Admin", async () => {
    const ana = fakeUser("ana", { password: "", google_email: "ana@example.com" });
    installFakeApi({ googleSignIn: true, users: [FAKE_ADMIN, ana], sessionUserId: ana.id });
    renderAccount();

    const section = await googleSection();
    expect(within(section).getByText("Signs in with Google as ana@example.com")).toBeVisible();
    expect(within(section).queryByRole("button", { name: "Link Google account" })).toBeNull();
    expect(screen.getByLabelText("Email")).toHaveAttribute("readonly");
    expect(screen.getByText("None. You sign in with Google.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Change password" })).toBeNull();
    expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(
      "Your email matches your Google sign-in. Ask an admin to change it.",
    );
  });

  it("reports the outcome when Google sends the browser back", async () => {
    installFakeApi({ googleSignIn: true });
    renderAccount("/settings/account?googleLink=email_mismatch");

    expect(await within(await googleSection()).findByRole("alert")).toHaveTextContent(
      "That Google account’s email doesn’t match this account’s. Ask an admin to update your email first.",
    );
  });

  it("offers nothing when the instance has no Google sign-in", async () => {
    installFakeApi();
    renderAccount();

    await screen.findByLabelText("Username");

    expect(screen.queryByRole("region", { name: "Sign in with Google" })).toBeNull();
  });
});
