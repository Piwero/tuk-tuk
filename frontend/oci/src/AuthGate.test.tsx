import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { AuthGate } from "./AuthGate";
import { fetchLists } from "./api";
import { FAKE_PASSWORD, fakeTask, installFakeApi } from "./test/fakeApi";

describe("AuthGate", () => {
  it("shows the password screen instead of the app without a session", async () => {
    installFakeApi({ loggedIn: false, tasks: [fakeTask("Buy milk")] });

    render(<AuthGate />);

    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
    expect(screen.queryByText("Buy milk")).not.toBeInTheDocument();
  });

  it("renders the app, with Lists and Tasks loading, after the correct password", async () => {
    installFakeApi({ loggedIn: false, tasks: [fakeTask("Buy milk")] });
    const user = userEvent.setup();
    render(<AuthGate />);

    const passwordField = await screen.findByLabelText("Password");
    expect(passwordField).toHaveFocus();
    await user.type(passwordField, `${FAKE_PASSWORD}{Enter}`);

    expect(await screen.findByText("Buy milk")).toBeInTheDocument();
  });

  it("shows an error and keeps the password screen after an incorrect password", async () => {
    installFakeApi({ loggedIn: false });
    const user = userEvent.setup();
    render(<AuthGate />);

    const passwordField = await screen.findByLabelText("Password");
    await user.type(passwordField, "wrong-password{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect password");
    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
  });

  it("renders the app directly when a session already exists", async () => {
    installFakeApi({ loggedIn: true, tasks: [fakeTask("Buy milk")] });

    render(<AuthGate />);

    expect(await screen.findByText("Buy milk")).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("returns to the password screen when a later request reports the session lapsed", async () => {
    const api = installFakeApi({ loggedIn: true, tasks: [fakeTask("Buy milk")] });
    const user = userEvent.setup();
    render(<AuthGate />);

    expect(await screen.findByText("Buy milk")).toBeInTheDocument();

    // Simulate the session expiring server-side, then a later request failing —
    // the shared request helper is what the app's own components go through.
    api.loggedIn = false;
    await act(() => expect(fetchLists()).rejects.toThrow());

    const passwordField = await screen.findByLabelText("Password");
    await user.type(passwordField, `${FAKE_PASSWORD}{Enter}`);

    expect(await screen.findByText("Buy milk")).toBeInTheDocument();
  });
});
