import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthGate } from "./AuthGate";
import { browserNavigation } from "./navigation";
import { FAKE_GOOGLE_URL, fakeInvitation, installFakeApi } from "./test/fakeApi";

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
  sessionStorage.clear();
});

function spyOnNavigation(): ReturnType<typeof vi.fn> {
  const assign = vi.fn();
  vi.spyOn(browserNavigation, "assign").mockImplementation(assign);
  return assign;
}

describe("Signing in with Google (#586)", () => {
  it("offers Continue with Google and sends the browser to Google", async () => {
    installFakeApi({ loggedIn: false, googleSignIn: true });
    const assign = spyOnNavigation();
    const user = userEvent.setup();
    render(<AuthGate />);

    await user.click(await screen.findByRole("button", { name: "Continue with Google" }));

    expect(assign).toHaveBeenCalledWith(`${FAKE_GOOGLE_URL}?purpose=login`);
    // Password sign-in is still right there.
    expect(screen.getByLabelText("Username or email")).toBeInTheDocument();
  });

  it("shows no Google option when the instance has none", async () => {
    installFakeApi({ loggedIn: false });
    render(<AuthGate />);

    await screen.findByLabelText("Username or email");

    expect(screen.queryByRole("button", { name: "Continue with Google" })).not.toBeInTheDocument();
  });

  it("says a Google account with no access was refused, without creating anything", async () => {
    window.history.replaceState(null, "", "/?signInError=not_recognized");
    installFakeApi({ loggedIn: false, googleSignIn: true });
    render(<AuthGate />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That Google account doesn’t have access. Ask your admin for an invitation, or sign in with your password.",
    );
    await waitFor(() => expect(window.location.search).toBe(""));
  });

  it("says a disabled account can't sign in with Google either", async () => {
    window.history.replaceState(null, "", "/?signInError=account_disabled");
    installFakeApi({ loggedIn: false, googleSignIn: true });
    render(<AuthGate />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This account is disabled. Contact your admin.",
    );
  });
});

describe("Accepting an invitation (#586)", () => {
  it("shows who the link is for and continues with Google, hiding the token", async () => {
    const invitation = fakeInvitation("ana@example.com");
    installFakeApi({ loggedIn: false, googleSignIn: true, invitations: [invitation] });
    window.history.replaceState(null, "", `/invite#token=${invitation.token}`);
    const assign = spyOnNavigation();
    const user = userEvent.setup();
    render(<AuthGate />);

    expect(await screen.findByText("ana@example.com")).toBeInTheDocument();
    expect(window.location.hash).toBe("");
    await user.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(assign).toHaveBeenCalledWith(`${FAKE_GOOGLE_URL}?purpose=invitation`);
  });

  it("says an invitation that can no longer be used is closed", async () => {
    const invitation = fakeInvitation("ana@example.com", { status: "expired" });
    installFakeApi({ loggedIn: false, googleSignIn: true, invitations: [invitation] });
    window.history.replaceState(null, "", `/invite#token=${invitation.token}`);
    render(<AuthGate />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This invitation has expired. Ask your admin to send it again.",
    );
    expect(screen.queryByRole("button", { name: "Continue with Google" })).not.toBeInTheDocument();
  });

  it("explains a Google account that doesn't match the invitation, and lets them try again", async () => {
    const invitation = fakeInvitation("ana@example.com");
    installFakeApi({ loggedIn: false, googleSignIn: true, invitations: [invitation] });
    window.history.replaceState(null, "", `/invite#token=${invitation.token}`);
    const { unmount } = render(<AuthGate />);
    await screen.findByText("ana@example.com");
    unmount();

    window.history.replaceState(null, "", "/invite?error=email_mismatch");
    render(<AuthGate />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That Google account isn’t the one invited. Continue with the Google account for the invited email.",
    );
    expect(await screen.findByText("ana@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
  });

  it("creates the account with a chosen username, then offers Calendar, which can be skipped", async () => {
    const invitation = fakeInvitation("ana@example.com");
    const api = installFakeApi({
      loggedIn: false,
      users: [],
      googleSignIn: true,
      invitations: [invitation],
      verifiedInvitation: invitation.token,
    });
    // Back from Google: the identity checked out, the username comes next.
    window.history.replaceState(null, "", "/invite?step=username");
    const user = userEvent.setup();
    render(<AuthGate />);

    await user.type(await screen.findByLabelText("Username"), "ana{Enter}");

    expect(
      await screen.findByRole("heading", { name: "Connect Google Calendar?" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect Google Calendar" })).toHaveAttribute(
      "href",
      expect.stringContaining("/api/v1/google/connect"),
    );
    await user.click(screen.getByRole("button", { name: "Skip for now" }));

    expect(await screen.findByRole("button", { name: "Account menu" })).toBeInTheDocument();
    expect(api.users.map((account) => account.username)).toEqual(["ana"]);
  });

  it("keeps the person on the username step when that name is taken", async () => {
    const invitation = fakeInvitation("ana@example.com");
    installFakeApi({
      loggedIn: false,
      googleSignIn: true,
      invitations: [invitation],
      verifiedInvitation: invitation.token,
    });
    window.history.replaceState(null, "", "/invite?step=username");
    const user = userEvent.setup();
    render(<AuthGate />);

    await user.type(await screen.findByLabelText("Username"), "admin{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("That username is already taken.");
    expect(screen.getByLabelText("Username")).toHaveAccessibleDescription(
      "That username is already taken.",
    );
  });
});
