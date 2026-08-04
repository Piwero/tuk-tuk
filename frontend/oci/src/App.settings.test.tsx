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

  it("lists an account's calendars by name once expanded", async () => {
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
      ],
      googleCalendars: [
        {
          id: 10,
          account_id: 1,
          google_calendar_id: "cal-1",
          summary: "Work",
          color: "#4772fa",
          enabled: true,
        },
        {
          id: 11,
          account_id: 1,
          google_calendar_id: "cal-2",
          summary: "Holidays",
          color: "#e5484d",
          enabled: false,
        },
      ],
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Settings" }));
    await user.click(await screen.findByText("work@example.com"));

    expect(await screen.findByText("Work")).toBeInTheDocument();
    expect(screen.getByText("Holidays")).toBeInTheDocument();
  });

  it("toggling a calendar's visibility persists across reloads", async () => {
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
      googleCalendars: [
        {
          id: 10,
          account_id: 1,
          google_calendar_id: "cal-1",
          summary: "Work",
          color: "#4772fa",
          enabled: true,
        },
      ],
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Settings" }));
    await user.click(await screen.findByText("work@example.com"));
    const checkbox = await screen.findByRole("checkbox", { name: "Work" });
    expect(checkbox).toBeChecked();

    await user.click(checkbox);

    await waitFor(() => expect(checkbox).not.toBeChecked());
    expect(
      state.requests.some(
        (r) =>
          r.method === "PATCH" &&
          r.url === "/api/v1/google/accounts/1/calendars/10" &&
          (r.body as { enabled?: boolean }).enabled === false,
      ),
    ).toBe(true);
  });

  it("changing a calendar's colour picks from tuk-tuk's own palette", async () => {
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
      googleCalendars: [
        {
          id: 10,
          account_id: 1,
          google_calendar_id: "cal-1",
          summary: "Work",
          color: "#4772fa",
          enabled: true,
        },
      ],
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Settings" }));
    await user.click(await screen.findByText("work@example.com"));
    await screen.findByText("Work");

    await user.click(screen.getByRole("radio", { name: "Red" }));

    await waitFor(() => {
      expect(
        state.requests.some(
          (r) =>
            r.method === "PATCH" &&
            r.url === "/api/v1/google/accounts/1/calendars/10" &&
            (r.body as { color?: string }).color === "#e5484d",
        ),
      ).toBe(true);
    });
  });

  it("a manual refresh picks up a calendar created since connecting", async () => {
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
      googleCalendars: [
        {
          id: 10,
          account_id: 1,
          google_calendar_id: "cal-1",
          summary: "Work",
          color: "#4772fa",
          enabled: true,
        },
      ],
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Settings" }));
    await user.click(await screen.findByText("work@example.com"));
    await screen.findByText("Work");

    // A calendar created in Google since connecting, discovered on refresh.
    state.googleCalendars.push({
      id: 11,
      account_id: 1,
      google_calendar_id: "cal-2",
      summary: "New Calendar",
      color: "#e5484d",
      enabled: true,
    });
    await user.click(screen.getByRole("button", { name: "Refresh calendars" }));

    expect(await screen.findByText("New Calendar")).toBeInTheDocument();
    expect(
      state.requests.some(
        (r) => r.method === "POST" && r.url === "/api/v1/google/accounts/1/calendars/refresh",
      ),
    ).toBe(true);
  });

  it("disconnecting an account removes its calendars", async () => {
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
      ],
      googleCalendars: [
        {
          id: 10,
          account_id: 1,
          google_calendar_id: "cal-1",
          summary: "Work",
          color: "#4772fa",
          enabled: true,
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
    expect(screen.queryByText("Work")).not.toBeInTheDocument();
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
