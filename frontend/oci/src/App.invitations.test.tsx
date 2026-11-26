import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "./App";
import { FAKE_ADMIN, fakeInvitation, fakeUser, installFakeApi } from "./test/fakeApi";

/** Settings › Users › Invitations (#586): an Admin invites an email
 * address, sees each invitation's status and what happened to its email,
 * and recovers from a delivery failure. */

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

function invitationRow(email: string): HTMLElement {
  const table = screen.getByRole("table", { name: "Invitations" });
  const row = within(table)
    .getAllByRole("row")
    .find((candidate) => within(candidate).queryByText(email) !== null);
  if (row === undefined) throw new Error(`No invitation row for ${email}`);
  return row;
}

describe("Inviting people (#586)", () => {
  it("invites an email address and lists it as pending and emailed", async () => {
    installFakeApi({ googleSignIn: true });
    const user = await openUsers();

    await user.type(await screen.findByLabelText("Email to invite"), "ana@example.com");
    await user.click(screen.getByRole("button", { name: "Invite" }));

    const row = await screen.findByRole("row", { name: /ana@example.com/ });
    expect(within(row).getByText("Pending")).toBeInTheDocument();
    expect(within(row).getByText("Emailed")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Invitation sent to ana@example.com.");
    expect(screen.getByLabelText("Email to invite")).toHaveValue("");
  });

  it("says plainly when the email could not be sent, and offers to retry or copy the link", async () => {
    installFakeApi({
      googleSignIn: true,
      invitations: [
        fakeInvitation("ana@example.com", {
          delivery: "failed",
          delivery_error: "Could not connect to the mail server",
        }),
      ],
    });
    const user = await openUsers();
    await screen.findByRole("table", { name: "Invitations" });

    const row = invitationRow("ana@example.com");
    expect(
      within(row).getByText("Not emailed: Could not connect to the mail server"),
    ).toBeVisible();
    await user.click(within(row).getByRole("button", { name: "Copy link" }));
    expect(await navigator.clipboard.readText()).toBe(
      "http://localhost:5900/invite#token=token-for-ana@example.com",
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Link copied.");

    await user.click(within(row).getByRole("button", { name: "Retry sending" }));
    expect(await within(invitationRow("ana@example.com")).findByText("Emailed")).toBeVisible();
  });

  it("explains a taken email without inviting it", async () => {
    installFakeApi({ googleSignIn: true, users: [FAKE_ADMIN, fakeUser("ben")] });
    const user = await openUsers();

    await user.type(await screen.findByLabelText("Email to invite"), "ben@example.com");
    await user.click(screen.getByRole("button", { name: "Invite" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Someone already has an account with that email.",
    );
  });

  it("resends an expired invitation and cancels a pending one", async () => {
    installFakeApi({
      googleSignIn: true,
      invitations: [
        fakeInvitation("old@example.com", { status: "expired" }),
        fakeInvitation("new@example.com"),
      ],
    });
    const user = await openUsers();
    await screen.findByRole("table", { name: "Invitations" });

    await user.click(
      within(invitationRow("old@example.com")).getByRole("button", { name: "Resend" }),
    );
    expect(await within(invitationRow("old@example.com")).findByText("Pending")).toBeVisible();

    await user.click(
      within(invitationRow("new@example.com")).getByRole("button", { name: "Cancel" }),
    );
    expect(await within(invitationRow("new@example.com")).findByText("Canceled")).toBeVisible();
    expect(
      within(invitationRow("new@example.com")).queryByRole("button", { name: "Copy link" }),
    ).not.toBeInTheDocument();
  });

  it("explains why nobody can be invited without Google sign-in", async () => {
    installFakeApi({ googleSignIn: false });
    await openUsers();

    expect(
      await screen.findByText(
        "Invitations need Google sign-in, which isn’t set up on this instance.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Email to invite")).not.toBeInTheDocument();
  });

  it("warns when invitations can't be emailed, so links must be copied", async () => {
    installFakeApi({ googleSignIn: true, emailDelivery: false });
    await openUsers();

    expect(
      await screen.findByText(
        "Email isn’t set up on this instance: copy each invitation’s link and send it yourself.",
      ),
    ).toBeInTheDocument();
  });
});

describe("Google sign-in on accounts (#586)", () => {
  it("shows which accounts sign in with Google and lets an Admin remove it after confirming", async () => {
    const api = installFakeApi({
      googleSignIn: true,
      users: [FAKE_ADMIN, fakeUser("ana", { password: "", google_email: "ana@gmail.com" })],
    });
    const user = await openUsers();

    const row = await screen.findByRole("row", { name: /ana/ });
    expect(within(row).getByText("Google: ana@gmail.com")).toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "Actions for ana" }));
    await user.click(screen.getByRole("menuitem", { name: "Remove Google sign-in" }));
    const dialog = screen.getByRole("dialog", { name: "Remove Google sign-in for ana?" });
    await user.click(within(dialog).getByRole("button", { name: "Remove Google sign-in" }));

    expect(
      await within(screen.getByRole("row", { name: /ana/ })).findByText(/No way to sign in/),
    ).toBeInTheDocument();
    expect(api.users.find((account) => account.username === "ana")?.google_email).toBeNull();
  });

  it("lets an Admin reconcile an account's email", async () => {
    installFakeApi({ users: [FAKE_ADMIN, fakeUser("ana")] });
    const user = await openUsers();

    const row = await screen.findByRole("row", { name: /ana/ });
    await user.click(within(row).getByRole("button", { name: "Actions for ana" }));
    await user.click(screen.getByRole("menuitem", { name: "Change email" }));
    const dialog = screen.getByRole("dialog", { name: "Change ana’s email" });
    const field = within(dialog).getByLabelText("Email");
    await user.clear(field);
    await user.type(field, "ana.new@example.com{Enter}");

    expect(
      await within(screen.getByRole("row", { name: /ana/ })).findByText("ana.new@example.com"),
    ).toBeInTheDocument();
  });
});
