import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { installFakeApi } from "./test/fakeApi";

// Note: fetch stays stubbed across tests (each test installs a fresh fake).
afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("The Assistant's settings (ADR 0009, issue #185)", () => {
  it("shows the saved base URL, model, and planning preferences on load", async () => {
    installFakeApi({
      assistantBaseUrl: "https://api.openai.com/v1",
      assistantModel: "gpt-4o-mini",
      assistantPlanningPreferences: "work 9-6, lunch 1-2",
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));

    expect(await screen.findByLabelText("Base URL")).toHaveValue("https://api.openai.com/v1");
    expect(screen.getByLabelText("Assistant model")).toHaveValue("gpt-4o-mini");
    expect(screen.getByLabelText("Planning preferences")).toHaveValue("work 9-6, lunch 1-2");
  });

  it("shows an already-saved API key as a masked placeholder, never its value", async () => {
    installFakeApi({ assistantApiKeySet: true });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));

    expect(await screen.findByText(/An API key is already saved/)).toBeInTheDocument();
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
  });

  it("saves the entered base URL, model, API key, and planning preferences", async () => {
    installFakeApi({});
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await user.type(await screen.findByLabelText("Base URL"), "https://api.openai.com/v1");
    await user.type(screen.getByLabelText("Assistant model"), "gpt-4o-mini");
    await user.type(screen.getByLabelText("API key"), "sk-secret");
    await user.type(screen.getByLabelText("Planning preferences"), "work 9-6");
    await user.click(screen.getByRole("button", { name: "Save Assistant settings" }));

    await screen.findByText(/An API key is already saved/);
    expect(screen.getByLabelText("Base URL")).toHaveValue("https://api.openai.com/v1");
    expect(screen.getByLabelText("Assistant model")).toHaveValue("gpt-4o-mini");
    expect(screen.getByLabelText("Planning preferences")).toHaveValue("work 9-6");
  });

  it("Test Assistant connection reports availability from the status endpoint", async () => {
    installFakeApi({
      assistantBaseUrl: "https://api.openai.com/v1",
      assistantModel: "gpt-4o-mini",
      assistantApiKeySet: true,
      assistantAvailable: true,
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await user.click(await screen.findByRole("button", { name: "Test Assistant connection" }));

    expect(await screen.findByText(/The Assistant is available/)).toBeInTheDocument();
  });

  it("Test Assistant connection reports when the Assistant is unavailable", async () => {
    installFakeApi({
      assistantBaseUrl: "https://api.openai.com/v1",
      assistantModel: "gpt-4o-mini",
      assistantApiKeySet: true,
      assistantAvailable: false,
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await user.click(await screen.findByRole("button", { name: "Test Assistant connection" }));

    expect(await screen.findByText(/The Assistant is unavailable/)).toBeInTheDocument();
  });

  it("disables Test Assistant connection while the form has unsaved edits", async () => {
    installFakeApi({
      assistantBaseUrl: "https://api.openai.com/v1",
      assistantModel: "gpt-4o-mini",
      assistantApiKeySet: true,
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await user.type(await screen.findByLabelText("Assistant model"), "-edited");

    expect(screen.getByRole("button", { name: "Test Assistant connection" })).toBeDisabled();
  });

  it("offers no Remove action when nothing is configured yet", async () => {
    installFakeApi({});
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await screen.findByLabelText("Base URL");

    expect(
      screen.queryByRole("button", { name: "Remove Assistant configuration" }),
    ).not.toBeInTheDocument();
  });

  it("Remove clears the saved config back to blank fields", async () => {
    installFakeApi({
      assistantBaseUrl: "https://api.openai.com/v1",
      assistantModel: "gpt-4o-mini",
      assistantApiKeySet: true,
      assistantPlanningPreferences: "work 9-6",
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await user.click(await screen.findByRole("button", { name: "Remove Assistant configuration" }));

    expect(await screen.findByLabelText("Base URL")).toHaveValue("");
    expect(screen.getByLabelText("Assistant model")).toHaveValue("");
    expect(screen.getByLabelText("Planning preferences")).toHaveValue("");
    expect(
      screen.queryByRole("button", { name: "Remove Assistant configuration" }),
    ).not.toBeInTheDocument();
  });

  it("Settings states that Assist is local and the Assistant is cloud", async () => {
    installFakeApi({});
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));

    expect(
      await screen.findByText(/Local — runs entirely on your own machine/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Cloud — every turn sends/)).toBeInTheDocument();
  });

  it("renders no Assistant nav item when nothing is configured", async () => {
    installFakeApi({});
    render(<App />);

    await screen.findByRole("link", { name: "Settings" });
    expect(screen.queryByRole("link", { name: "Assistant" })).not.toBeInTheDocument();
  });

  it("shows the Assistant nav item once the provider is available, and opens the view", async () => {
    installFakeApi({ assistantAvailable: true });
    const user = userEvent.setup();
    render(<App />);

    const link = await screen.findByRole("link", { name: "Assistant" });
    await user.click(link);

    expect(await screen.findByText("The Assistant is configured and ready.")).toBeInTheDocument();
  });

  it("never shows the API key back in the DOM after saving", async () => {
    installFakeApi({});
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await user.type(await screen.findByLabelText("API key"), "sk-secret");
    await user.click(screen.getByRole("button", { name: "Save Assistant settings" }));

    await screen.findByText(/An API key is already saved/);
    expect(screen.queryByDisplayValue("sk-secret")).not.toBeInTheDocument();
  });
});
