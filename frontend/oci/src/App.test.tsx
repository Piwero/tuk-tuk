import { render, screen, within } from "@testing-library/react";
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
    const api = installFakeApi({ tasks: [fakeTask("Water plants")] });
    const user = userEvent.setup();
    render(<App />);

    const checkbox = await screen.findByRole("checkbox", { name: "Complete Water plants" });
    expect(checkbox).not.toBeChecked();

    await user.click(checkbox);
    expect(await screen.findByRole("checkbox", { name: "Complete Water plants" })).toBeChecked();

    await user.click(checkbox);
    expect(
      await screen.findByRole("checkbox", { name: "Complete Water plants" }),
    ).not.toBeChecked();

    const patches = api.requests.filter((r) => r.method === "PATCH");
    expect(patches.map((r) => r.body)).toEqual([{ completed: true }, { completed: false }]);
  });

  it("deletes a task from the list", async () => {
    const api = installFakeApi({ tasks: [fakeTask("Old chore")] });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Delete Old chore" }));

    expect(screen.queryByText("Old chore")).not.toBeInTheDocument();
    expect(api.requests.some((r) => r.method === "DELETE")).toBe(true);
  });

  it("shows a description indicator on the row only for a task that has one", async () => {
    installFakeApi({
      tasks: [
        fakeTask("Bare task"),
        fakeTask("Detailed task", { description: "Bring the receipts" }),
      ],
    });
    render(<App />);

    await screen.findByRole("button", { name: "Open details for Bare task" });
    const bareRow = screen
      .getByRole("button", { name: "Open details for Bare task" })
      .closest("li");
    const detailedRow = screen
      .getByRole("button", { name: "Open details for Detailed task" })
      .closest("li");
    if (bareRow === null || detailedRow === null) {
      throw new Error("row not found");
    }

    expect(within(bareRow).queryByLabelText("Has a description")).not.toBeInTheDocument();
    expect(within(detailedRow).getByLabelText("Has a description")).toBeInTheDocument();
  });
});
