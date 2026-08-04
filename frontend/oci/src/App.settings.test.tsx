import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { installFakeApi } from "./test/fakeApi";

// Note: fetch stays stubbed across tests (each test installs a fresh fake).
afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("Google Calendar gate", () => {
  it("shows no Google wording anywhere when the integration is unconfigured", async () => {
    installFakeApi({ googleConfigured: false });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Settings" }));

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByText(/google/i)).not.toBeInTheDocument();
  });

  it("shows a Google Calendar section with nothing connected when configured", async () => {
    installFakeApi({ googleConfigured: true });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Settings" }));

    expect(await screen.findByRole("heading", { name: "Google Calendar" })).toBeInTheDocument();
    expect(screen.getByText(/no accounts connected/i)).toBeInTheDocument();
  });

  it("offers a Connect action that navigates to the backend's connect route", async () => {
    installFakeApi({ googleConfigured: true });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Settings" }));

    const connectLink = await screen.findByRole("link", { name: "Connect" });
    expect(connectLink).toHaveAttribute("href", "/api/v1/google/connect");
  });

  it("lists every connected account by its email address", async () => {
    installFakeApi({
      googleConfigured: true,
      googleAccounts: [
        {
          id: 1,
          google_account_id: "google-1",
          email: "work@example.com",
          connection_state: "connected",
          created_at: "2026-08-01T00:00:00Z",
        },
        {
          id: 2,
          google_account_id: "google-2",
          email: "personal@example.com",
          connection_state: "connected",
          created_at: "2026-08-01T00:00:00Z",
        },
      ],
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Settings" }));

    expect(await screen.findByText("work@example.com")).toBeInTheDocument();
    expect(screen.getByText("personal@example.com")).toBeInTheDocument();
    expect(screen.queryByText(/no accounts connected/i)).not.toBeInTheDocument();
  });

  it("disconnecting an account removes it from the list", async () => {
    const state = installFakeApi({
      googleConfigured: true,
      googleAccounts: [
        {
          id: 1,
          google_account_id: "google-1",
          email: "work@example.com",
          connection_state: "connected",
          created_at: "2026-08-01T00:00:00Z",
        },
      ],
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Settings" }));
    await screen.findByText("work@example.com");
    await user.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() => {
      expect(screen.queryByText("work@example.com")).not.toBeInTheDocument();
    });
    expect(screen.getByText(/no accounts connected/i)).toBeInTheDocument();
    expect(
      state.requests.some((r) => r.method === "DELETE" && r.url === "/api/v1/google/accounts/1"),
    ).toBe(true);
  });

  it("opens Settings and shows an error after a failed Google consent round trip", async () => {
    installFakeApi({ googleConfigured: true });
    window.history.replaceState(null, "", "/?googleError=1");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Google Calendar" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/didn't complete/i);
    expect(window.location.search).toBe("");
  });

  it("opens Settings after a successful Google consent round trip", async () => {
    installFakeApi({
      googleConfigured: true,
      googleAccounts: [
        {
          id: 1,
          google_account_id: "google-1",
          email: "me@example.com",
          connection_state: "connected",
          created_at: "2026-08-01T00:00:00Z",
        },
      ],
    });
    window.history.replaceState(null, "", "/?googleConnected=1");

    render(<App />);

    expect(await screen.findByText("me@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(window.location.search).toBe("");
  });
});
