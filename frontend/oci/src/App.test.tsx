import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { fakeTask, INBOX, installFakeApi } from "./test/fakeApi";

// Note: fetch stays stubbed across tests (each test installs a fresh fake).
// Restoring the real fetch between tests would let a late in-flight request
// from an unmounting App escape to the network and fail the run.

describe("App", () => {
  it("shows the Inbox in the sidebar and renders its tasks", async () => {
    installFakeApi({ tasks: [fakeTask("Buy milk"), fakeTask("Water plants")] });

    render(<App />);

    expect(await screen.findByRole("button", { name: "Inbox" })).toBeInTheDocument();
    expect(await screen.findByText("Buy milk")).toBeInTheDocument();
    expect(screen.getByText("Water plants")).toBeInTheDocument();
  });

  it("adds a task typed into Quick-Add to the Inbox without a reload", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    render(<App />);

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "Buy milk{Enter}");

    expect(await screen.findByText("Buy milk")).toBeInTheDocument();
    expect(input).toHaveValue("");
    const post = api.requests.find((r) => r.method === "POST");
    expect(post).toBeDefined();
    expect(post?.body).toEqual({ title: "Buy milk", list_id: INBOX.id });
  });

  it("completes and un-completes a task from the list", async () => {
    // Completing goes through the undo toast (#155) — the PATCH only fires
    // once the toast is dismissed; un-completing an already-completed task
    // is immediate, since it isn't the reversible action the toast covers.
    const api = installFakeApi({ tasks: [fakeTask("Water plants")] });
    const user = userEvent.setup();
    render(<App />);

    const checkbox = await screen.findByRole("checkbox", { name: "Complete Water plants" });
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(api.requests.some((r) => r.method === "PATCH")).toBe(false);

    await user.click(await screen.findByRole("button", { name: "Dismiss" }));
    await waitFor(() => {
      const patches = api.requests.filter((r) => r.method === "PATCH");
      expect(patches.map((r) => r.body)).toEqual([{ completed: true }]);
    });

    await user.click(screen.getByRole("checkbox", { name: "Complete Water plants" }));
    await waitFor(() => {
      const patches = api.requests.filter((r) => r.method === "PATCH");
      expect(patches.map((r) => r.body)).toEqual([{ completed: true }, { completed: false }]);
    });
    expect(
      await screen.findByRole("checkbox", { name: "Complete Water plants" }),
    ).not.toBeChecked();
  });

  it("holds a completion pending until the undo toast is dismissed, and undo cancels it", async () => {
    const api = installFakeApi({ tasks: [fakeTask("Water plants")] });
    const user = userEvent.setup();
    render(<App />);

    const checkbox = await screen.findByRole("checkbox", { name: "Complete Water plants" });
    await user.click(checkbox);

    // "Completed" also names the completed-view toggle button, so scope the
    // assertion to the toast itself (role="status").
    expect(await screen.findByRole("status")).toHaveTextContent("Completed");
    expect(api.requests.some((r) => r.method === "PATCH")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Undo" }));

    expect(screen.getByRole("checkbox", { name: "Complete Water plants" })).not.toBeChecked();
    expect(api.requests.some((r) => r.method === "PATCH")).toBe(false);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("deletes a task from the list through an undoable toast", async () => {
    const api = installFakeApi({ tasks: [fakeTask("Old chore")] });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Delete Old chore" }));

    // Removed from view at once, but nothing sent to the backend yet.
    expect(screen.queryByText("Old chore")).not.toBeInTheDocument();
    expect(api.requests.some((r) => r.method === "DELETE")).toBe(false);
    expect(await screen.findByText("Task deleted")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => expect(api.requests.some((r) => r.method === "DELETE")).toBe(true));
  });

  it("undoing a delete restores the task without ever calling the backend", async () => {
    const api = installFakeApi({ tasks: [fakeTask("Old chore")] });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Delete Old chore" }));
    expect(screen.queryByText("Old chore")).not.toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "Undo" }));

    expect(await screen.findByText("Old chore")).toBeInTheDocument();
    expect(api.requests.some((r) => r.method === "DELETE")).toBe(false);
  });
});
