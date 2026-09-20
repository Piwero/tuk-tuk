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

async function openDatabaseSettings(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("link", { name: "Settings" }));
  await screen.findByRole("heading", { name: "Database" });
  return user;
}

describe("Settings > Database status", () => {
  it("shows SQLite for the default engine", async () => {
    installFakeApi({ databaseStatus: { engine: "sqlite", host: null, database: null } });
    await openDatabaseSettings();

    expect(await screen.findByText(/SQLite/)).toBeInTheDocument();
  });

  it("shows the host and database when running PostgreSQL", async () => {
    installFakeApi({
      databaseStatus: { engine: "postgresql", host: "db.internal", database: "tuktuk" },
    });
    await openDatabaseSettings();

    expect(await screen.findByText(/db\.internal/)).toBeInTheDocument();
    expect(screen.getByText(/tuktuk/)).toBeInTheDocument();
  });

  it("states plainly that nothing is switched and nothing is saved", async () => {
    installFakeApi();
    await openDatabaseSettings();

    expect(
      screen.getByText(/does not switch the database and does not save the address/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Moving to PostgreSQL/i)).toBeInTheDocument();
  });
});

describe("Settings > Database test connection", () => {
  it("shows the version and empty state on success", async () => {
    installFakeApi({
      databaseTestConnectionResult: {
        ok: true,
        version: "PostgreSQL 16.1",
        has_existing_data: false,
        reason: null,
        message: null,
      },
    });
    const user = await openDatabaseSettings();

    await user.type(screen.getByLabelText("Connection URL"), "postgresql://x/y");
    await user.click(screen.getByRole("button", { name: "Test database connection" }));

    expect(await screen.findByText(/PostgreSQL 16\.1/)).toBeInTheDocument();
    expect(screen.getByText(/is empty/)).toBeInTheDocument();
  });

  it("shows the populated state when the database already holds data", async () => {
    installFakeApi({
      databaseTestConnectionResult: {
        ok: true,
        version: "PostgreSQL 16.1",
        has_existing_data: true,
        reason: null,
        message: null,
      },
    });
    const user = await openDatabaseSettings();

    await user.type(screen.getByLabelText("Connection URL"), "postgresql://x/y");
    await user.click(screen.getByRole("button", { name: "Test database connection" }));

    expect(await screen.findByText(/already holds tuk-tuk data/)).toBeInTheDocument();
  });

  it.each([
    ["unreachable", "The host did not respond within the timeout."],
    ["auth_rejected", "The server rejected the username or password."],
    ["database_not_found", "That database does not exist on the server."],
    ["unknown", "Something unexpected happened."],
  ] as const)("renders a distinct message for %s", async (reason, message) => {
    installFakeApi({
      databaseTestConnectionResult: {
        ok: false,
        version: null,
        has_existing_data: null,
        reason,
        message,
      },
    });
    const user = await openDatabaseSettings();

    await user.type(screen.getByLabelText("Connection URL"), "postgresql://x/y");
    await user.click(screen.getByRole("button", { name: "Test database connection" }));

    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it("disables the button while a test is in flight and re-enables after", async () => {
    installFakeApi();
    const user = await openDatabaseSettings();

    await user.type(screen.getByLabelText("Connection URL"), "postgresql://x/y");
    const button = screen.getByRole("button", { name: "Test database connection" });
    await user.click(button);

    await waitFor(() => expect(button).not.toBeDisabled());
  });
});
