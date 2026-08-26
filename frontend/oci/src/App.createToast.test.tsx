import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeList, fakeSection, fakeTask, INBOX, installFakeApi } from "./test/fakeApi";

// Note: fetch stays stubbed across tests (each test installs a fresh fake).
afterEach(() => {
  vi.restoreAllMocks();
});

async function quickAdd(user: ReturnType<typeof userEvent.setup>, title: string): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Quick add" }));
  await screen.findByRole("dialog", { name: "Quick add" });
  await user.type(await screen.findByLabelText("Title"), title);
  await user.click(screen.getByRole("button", { name: "Add task" }));
}

describe("Confirming a created Task", () => {
  it("names the destination List when created from the Quick add dialog", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    await quickAdd(user, "Review UX report");

    expect(await screen.findByRole("status")).toHaveTextContent("Added to Inbox");
  });

  it("appears on a non-task screen, where no task view is mounted to own a toast", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    const views = await screen.findByRole("navigation", { name: "Views" });
    await user.click(within(views).getByRole("link", { name: "Focus" }));
    await screen.findByRole("heading", { name: "Focus" });

    await quickAdd(user, "Review UX report");

    expect(await screen.findByRole("status")).toHaveTextContent("Added to Inbox");
  });

  it("offers a way to the Task when it landed outside the current view", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    const views = await screen.findByRole("navigation", { name: "Views" });
    await user.click(within(views).getByRole("link", { name: "Focus" }));
    await screen.findByRole("heading", { name: "Focus" });

    await quickAdd(user, "Review UX report");
    await user.click(await screen.findByRole("button", { name: "Show Task" }));

    expect(await screen.findByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    expect(await screen.findByText("Review UX report")).toBeInTheDocument();
  });

  it("offers no jump when the Task is already visible in the current view", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    await quickAdd(user, "Review UX report");

    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent("Added to Inbox");
    expect(within(toast).queryByRole("button", { name: "Show Task" })).not.toBeInTheDocument();
  });

  it("carries no Undo, because the Task already exists by the time it is shown", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    await quickAdd(user, "Review UX report");

    const toast = await screen.findByRole("status");
    expect(within(toast).queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    expect(within(toast).getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("renders exactly one toast stack, even on a task view that used to own its own", async () => {
    const { container } = (() => {
      installFakeApi({ tasks: [fakeTask("Old chore")] });
      return render(<App />);
    })();
    fireEvent.click(await screen.findByRole("button", { name: "Inbox" }));
    await screen.findByText("Old chore");

    fireEvent.click(screen.getByRole("button", { name: "Delete Old chore" }));

    await screen.findByRole("status");
    expect(container.querySelectorAll(".toast-stack")).toHaveLength(1);
  });

  it("confirms a Task added through the inline quick add", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const inline = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(inline, "Water the plants{Enter}");

    expect(await screen.findByRole("status")).toHaveTextContent("Added to Inbox");
  });

  it("confirms a card added from a Kanban column", async () => {
    const board = fakeList("Board", { view_mode: "kanban" });
    const backlog = fakeSection("Backlog", board.id);
    installFakeApi({ lists: [INBOX, board], sections: [backlog] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Board" }));

    const draft = await screen.findByRole("textbox", { name: "Add a task to Backlog" });
    await user.type(draft, "Draft the brief{Enter}");

    expect(await screen.findByRole("status")).toHaveTextContent("Added to Board");
  });

  it("does not survive a route change", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Inbox" }));
    await quickAdd(user, "Review UX report");
    await screen.findByRole("status");

    const views = screen.getByRole("navigation", { name: "Views" });
    await user.click(within(views).getByRole("link", { name: "Habits" }));

    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  // A pending undo toast (#155) is cleared by the same route change. Clearing
  // it *commits* rather than drops: the toast is gone, so the undo is
  // unreachable, and a silently pending DELETE would be worse than a sent one.
  it("commits a pending delete when the route changes out from under it", async () => {
    const api = installFakeApi({ tasks: [fakeTask("Old chore")] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Inbox" }));
    await screen.findByText("Old chore");

    await user.click(screen.getByRole("button", { name: "Delete Old chore" }));
    await screen.findByRole("status");
    expect(api.requests.some((r) => r.method === "DELETE")).toBe(false);

    const views = screen.getByRole("navigation", { name: "Views" });
    await user.click(within(views).getByRole("link", { name: "Habits" }));

    await waitFor(() => expect(api.requests.some((r) => r.method === "DELETE")).toBe(true));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
