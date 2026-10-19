import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { ApiError, changePassword } from "./api";
import { FAKE_PASSWORD, installFakeApi } from "./test/fakeApi";

// Note: fetch stays stubbed across tests (each test installs a fresh fake).
afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("Google Calendar gate", () => {
  it("shows only the credentials form, no account UI, when unconfigured", async () => {
    installFakeApi({ googleConfigured: false });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));

    expect(
      await screen.findByRole("heading", { name: "Google API credentials" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Client ID")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Connect" })).not.toBeInTheDocument();
    expect(screen.queryByText(/no accounts connected/i)).not.toBeInTheDocument();
  });

  it("shows a Google Calendar section with nothing connected when configured", async () => {
    installFakeApi({ googleConfigured: true });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));

    expect(await screen.findByRole("heading", { name: "Google Calendar" })).toBeInTheDocument();
    expect(screen.getByText(/no accounts connected/i)).toBeInTheDocument();
  });

  it("offers a Connect action that navigates to the backend's connect route", async () => {
    installFakeApi({ googleConfigured: true });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));

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

    await user.click(await screen.findByRole("link", { name: "Settings" }));

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

    await user.click(await screen.findByRole("link", { name: "Settings" }));
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

    await user.click(await screen.findByRole("link", { name: "Settings" }));
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

    await user.click(await screen.findByRole("link", { name: "Settings" }));
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

    await user.click(await screen.findByRole("link", { name: "Settings" }));
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

    await user.click(await screen.findByRole("link", { name: "Settings" }));
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

    await user.click(await screen.findByRole("link", { name: "Settings" }));
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

describe("Appearance (issue #193)", () => {
  it("renders the current choice, defaulting to System", async () => {
    localStorage.clear();
    installFakeApi({});
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));

    expect(await screen.findByRole("heading", { name: "Appearance" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Light" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Dark" })).not.toBeChecked();
  });

  it("reflects a previously stored choice on load", async () => {
    localStorage.clear();
    localStorage.setItem("tuktuk.theme", "dark");
    installFakeApi({});
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));

    expect(await screen.findByRole("radio", { name: "Dark" })).toBeChecked();
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("persists a new choice and applies it, surviving a reload", async () => {
    localStorage.clear();
    installFakeApi({});
    const user = userEvent.setup();
    const first = render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await user.click(await screen.findByRole("radio", { name: "Dark" }));

    expect(localStorage.getItem("tuktuk.theme")).toBe("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    first.unmount();

    render(<App />);
    await user.click(await screen.findByRole("link", { name: "Settings" }));
    expect(await screen.findByRole("radio", { name: "Dark" })).toBeChecked();
  });
});

describe("Active hours (issue #210)", () => {
  it("defaults to disabled with the 09:00–17:00 prefill", async () => {
    installFakeApi({ googleConfigured: false });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));

    const section = await screen.findByRole("region", { name: "Active hours" });
    const toggle = within(section).getByLabelText("Active hours");
    expect(toggle).not.toBeChecked();
    expect(within(section).getByLabelText("Start")).toHaveValue("09:00");
    expect(within(section).getByLabelText("End")).toHaveValue("17:00");
  });

  it("persists an enabled band to the server", async () => {
    const api = installFakeApi({ googleConfigured: false });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    const section = await screen.findByRole("region", { name: "Active hours" });

    await user.click(within(section).getByLabelText("Active hours"));
    await user.selectOptions(within(section).getByLabelText("Start"), "08:00");
    await user.selectOptions(within(section).getByLabelText("End"), "16:00");

    await waitFor(() =>
      expect(api.activeHours).toEqual({ enabled: true, start: "08:00", end: "16:00" }),
    );
  });

  it("flags a band that would start after it ends and does not save it", async () => {
    const api = installFakeApi({
      googleConfigured: false,
      activeHours: { enabled: true, start: "09:00", end: "17:00" },
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    const section = await screen.findByRole("region", { name: "Active hours" });

    await user.selectOptions(within(section).getByLabelText("Start"), "18:00");

    expect(await within(section).findByRole("alert")).toHaveTextContent(/start before they end/i);
    expect(api.activeHours).toEqual({ enabled: true, start: "09:00", end: "17:00" });
  });
});

describe("About section", () => {
  it("shows the running app version", async () => {
    installFakeApi({ googleConfigured: false });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));

    // Nothing sets VITE_APP_VERSION in the test suite, so it falls back to "dev".
    expect(await screen.findByText(/tuk-tuk version/i)).toHaveTextContent("tuk-tuk version dev");
  });
});

describe("Google API credentials (issue #117)", () => {
  it("saving credentials reveals the account-connect UI", async () => {
    const state = installFakeApi({ googleConfigured: false });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await user.type(screen.getByLabelText("Client ID"), "a-client-id");
    await user.type(screen.getByLabelText("Client secret"), "a-client-secret");
    await user.click(screen.getByRole("button", { name: "Save Google credentials" }));

    expect(await screen.findByRole("link", { name: "Connect" })).toBeInTheDocument();
    expect(screen.getByText(/no accounts connected/i)).toBeInTheDocument();
    const saveRequest = state.requests.find(
      (r) => r.method === "PUT" && r.url === "/api/v1/google/credentials",
    );
    expect(saveRequest?.body).toEqual({
      client_id: "a-client-id",
      client_secret: "a-client-secret",
    });
  });

  it("shows the client ID and a masked placeholder for an already-stored secret", async () => {
    installFakeApi({
      googleConfigured: true,
      googleClientId: "existing-client-id",
      googleClientSecretSet: true,
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));

    expect(await screen.findByLabelText("Client ID")).toHaveValue("existing-client-id");
    expect(screen.getByText(/client secret is already saved/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Client secret")).not.toBeInTheDocument();
  });

  it("saving without replacing the secret keeps it unchanged and omits it from the request", async () => {
    const state = installFakeApi({
      googleConfigured: true,
      googleClientId: "existing-client-id",
      googleClientSecretSet: true,
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    const clientIdField = await screen.findByLabelText("Client ID");
    await user.clear(clientIdField);
    await user.type(clientIdField, "new-client-id");
    await user.click(screen.getByRole("button", { name: "Save Google credentials" }));

    await waitFor(() => {
      const saveRequest = state.requests.find(
        (r) => r.method === "PUT" && r.url === "/api/v1/google/credentials",
      );
      expect(saveRequest?.body).toEqual({ client_id: "new-client-id" });
    });
    expect(state.googleClientId).toBe("new-client-id");
    expect(state.googleClientSecretSet).toBe(true);
  });

  it("editing credentials while an account is connected flips it to needs_reconnect", async () => {
    installFakeApi({
      googleConfigured: true,
      googleClientId: "existing-client-id",
      googleClientSecretSet: true,
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
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await user.click(await screen.findByRole("button", { name: "Replace it" }));
    await user.type(screen.getByLabelText("Client secret"), "new-client-secret");
    await user.click(screen.getByRole("button", { name: "Save Google credentials" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/needs to be reconnected/i);
  });

  it("removing the integration returns Settings to the unconfigured state", async () => {
    installFakeApi({
      googleConfigured: true,
      googleClientId: "existing-client-id",
      googleClientSecretSet: true,
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
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await screen.findByText("me@example.com");
    await user.click(screen.getByRole("button", { name: "Remove Google integration" }));

    await waitFor(() => {
      expect(screen.queryByRole("link", { name: "Connect" })).not.toBeInTheDocument();
    });
    expect(screen.queryByText("me@example.com")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Client ID")).toHaveValue("");
  });
});

describe("Change password (issue #116)", () => {
  it("shows a Security section with a change-password form", async () => {
    installFakeApi({});
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));

    expect(await screen.findByRole("heading", { name: "Security" })).toBeInTheDocument();
    expect(screen.getByLabelText("Current password")).toBeInTheDocument();
    expect(screen.getByLabelText("New password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm new password")).toBeInTheDocument();
  });

  it("submitting with the correct current password succeeds and clears the form", async () => {
    const state = installFakeApi({});
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await user.type(screen.getByLabelText("Current password"), FAKE_PASSWORD);
    await user.type(screen.getByLabelText("New password"), "a-new-password");
    await user.type(screen.getByLabelText("Confirm new password"), "a-new-password");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByText(/password changed/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Current password")).toHaveValue("");
    expect(screen.getByLabelText("New password")).toHaveValue("");
    expect(screen.getByLabelText("Confirm new password")).toHaveValue("");
    expect(state.password).toBe("a-new-password");
  });

  it("submitting with an incorrect current password shows an error and changes nothing", async () => {
    const state = installFakeApi({});
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await user.type(screen.getByLabelText("Current password"), "wrong-password");
    await user.type(screen.getByLabelText("New password"), "a-new-password");
    await user.type(screen.getByLabelText("Confirm new password"), "a-new-password");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/incorrect/i);
    expect(state.password).toBe(FAKE_PASSWORD);
  });

  it("shows an error and doesn't submit when the new password and confirmation don't match", async () => {
    const state = installFakeApi({});
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await user.type(screen.getByLabelText("Current password"), FAKE_PASSWORD);
    await user.type(screen.getByLabelText("New password"), "a-new-password");
    await user.type(screen.getByLabelText("Confirm new password"), "a-different-password");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("don't match");
    expect(state.password).toBe(FAKE_PASSWORD);
  });

  it("states the minimum password length before the person types", async () => {
    installFakeApi({});
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));

    expect(await screen.findByText(/12 characters/i)).toBeInTheDocument();
  });

  it("rejects a too-short new password client-side without issuing a request", async () => {
    const state = installFakeApi({});
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await user.type(screen.getByLabelText("Current password"), FAKE_PASSWORD);
    await user.type(screen.getByLabelText("New password"), "short");
    await user.type(screen.getByLabelText("Confirm new password"), "short");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("12 characters");
    expect(state.password).toBe(FAKE_PASSWORD);
  });

  it("the fake /password route applies the same minimum the real backend does", async () => {
    installFakeApi({});

    await expect(changePassword(FAKE_PASSWORD, "short")).rejects.toSatisfy(
      (err: unknown) => err instanceof ApiError && err.code === "invalid_password",
    );
  });

  it("shows the lockout message when changing the password is locked", async () => {
    installFakeApi({ passwordChangeLocked: true });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await user.type(screen.getByLabelText("Current password"), FAKE_PASSWORD);
    await user.type(screen.getByLabelText("New password"), "a-new-password");
    await user.type(screen.getByLabelText("Confirm new password"), "a-new-password");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many attempts");
  });
});

describe("Per-account failure handling (issue #109)", () => {
  it("offers a Reconnect action for an account needing reconnection", async () => {
    installFakeApi({
      googleConfigured: true,
      googleAccounts: [
        {
          id: 1,
          google_account_id: "google-1",
          email: "me@example.com",
          connection_state: "needs_reconnect",
          created_at: "2026-08-01T00:00:00Z",
        },
      ],
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/needs to be reconnected/i);
    const reconnectLinks = screen.getAllByRole("link", { name: "Reconnect" });
    expect(reconnectLinks[0]).toHaveAttribute("href", "/api/v1/google/connect");
  });

  it("shows no reconnection notice for a normally connected account", async () => {
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
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await screen.findByText("me@example.com");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Reconnect" })).not.toBeInTheDocument();
  });
});
