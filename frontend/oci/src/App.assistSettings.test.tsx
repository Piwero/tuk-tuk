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

describe("Assist settings (ADR 0005)", () => {
  it("shows the saved Ollama base URL and model on load", async () => {
    installFakeApi({
      assistOllamaBaseUrl: "http://localhost:11434",
      assistModel: "qwen3:14b",
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));

    expect(await screen.findByLabelText("Ollama base URL")).toHaveValue("http://localhost:11434");
    expect(screen.getByLabelText("Model")).toHaveValue("qwen3:14b");
  });

  it("saves the entered base URL and model", async () => {
    installFakeApi({});
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await user.type(await screen.findByLabelText("Ollama base URL"), "http://localhost:11434");
    await user.type(screen.getByLabelText("Model"), "qwen3:14b");
    await user.click(screen.getByRole("button", { name: "Save Assist settings" }));

    await screen.findByRole("button", { name: "Save Assist settings" });
    expect(screen.getByLabelText("Ollama base URL")).toHaveValue("http://localhost:11434");
    expect(screen.getByLabelText("Model")).toHaveValue("qwen3:14b");
  });

  it("Test connection reports availability from the status endpoint", async () => {
    installFakeApi({
      assistOllamaBaseUrl: "http://localhost:11434",
      assistModel: "qwen3:14b",
      assistAvailable: true,
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await user.click(await screen.findByRole("button", { name: "Test connection" }));

    expect(
      await screen.findByText(/Assist is available — Ollama is reachable/),
    ).toBeInTheDocument();
  });

  it("Test connection reports when Assist is unavailable", async () => {
    installFakeApi({
      assistOllamaBaseUrl: "http://localhost:11434",
      assistModel: "qwen3:14b",
      assistAvailable: false,
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await user.click(await screen.findByRole("button", { name: "Test connection" }));

    expect(await screen.findByText(/Assist is unavailable/)).toBeInTheDocument();
  });

  it("disables Test connection while the form has unsaved edits", async () => {
    installFakeApi({
      assistOllamaBaseUrl: "http://localhost:11434",
      assistModel: "qwen3:14b",
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    const modelInput = await screen.findByLabelText("Model");
    await user.type(modelInput, "-edited");

    expect(screen.getByRole("button", { name: "Test connection" })).toBeDisabled();
  });

  it("offers no Remove action when nothing is configured yet", async () => {
    installFakeApi({});
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await screen.findByLabelText("Ollama base URL");

    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("Remove clears the saved config back to blank fields", async () => {
    installFakeApi({
      assistOllamaBaseUrl: "http://localhost:11434",
      assistModel: "qwen3:14b",
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await user.click(await screen.findByRole("button", { name: "Remove" }));

    expect(await screen.findByLabelText("Ollama base URL")).toHaveValue("");
    expect(screen.getByLabelText("Model")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("shows Model as a dropdown of installed models once the saved base URL resolves any", async () => {
    installFakeApi({
      assistOllamaBaseUrl: "http://localhost:11434",
      assistModel: "qwen3:14b",
      assistInstalledModels: ["llama3:8b", "qwen3:14b"],
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));

    const select = await screen.findByLabelText("Model");
    expect(select.tagName).toBe("SELECT");
    expect(select).toHaveValue("qwen3:14b");
    expect(screen.getByRole("option", { name: "llama3:8b" })).toBeInTheDocument();
  });

  it("keeps a saved model not among the installed list as its own option", async () => {
    installFakeApi({
      assistOllamaBaseUrl: "http://localhost:11434",
      assistModel: "custom:model",
      assistInstalledModels: ["llama3:8b"],
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));

    const select = await screen.findByLabelText("Model");
    expect(select).toHaveValue("custom:model");
    expect(screen.getByRole("option", { name: "custom:model" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "llama3:8b" })).toBeInTheDocument();
  });

  it("stays a free-text field when no base URL is saved yet", async () => {
    installFakeApi({ assistInstalledModels: ["llama3:8b"] });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));

    expect((await screen.findByLabelText("Model")).tagName).toBe("INPUT");
  });

  it("Refresh models fetches against the typed (unsaved) base URL", async () => {
    installFakeApi({ assistInstalledModels: ["llama3:8b", "qwen3:14b"] });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await user.type(await screen.findByLabelText("Ollama base URL"), "http://localhost:11434");
    expect(screen.getByLabelText("Model").tagName).toBe("INPUT");

    await user.click(screen.getByRole("button", { name: "Refresh models" }));

    const select = await screen.findByLabelText("Model");
    expect(select.tagName).toBe("SELECT");
    expect(screen.getByRole("option", { name: "qwen3:14b" })).toBeInTheDocument();
  });

  it("Refresh models is disabled while no base URL is typed", async () => {
    installFakeApi({});
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await screen.findByLabelText("Ollama base URL");

    expect(screen.getByRole("button", { name: "Refresh models" })).toBeDisabled();
  });
});
