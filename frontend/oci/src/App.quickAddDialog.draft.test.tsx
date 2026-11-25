import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { App } from "./App";
import { fakeList, INBOX, installFakeApi, type RecordedRequest } from "./test/fakeApi";

// Quick-Add session draft (#541): an unsent capture is kept for the
// signed-in User in this browser session, and comes back on reopen.

afterEach(() => {
  vi.restoreAllMocks();
});

const taskPosts = (requests: RecordedRequest[]): unknown[] =>
  requests.filter((r) => r.method === "POST" && r.url === "/api/v1/tasks").map((r) => r.body);

const isTaskCreate = (method: string, pathname: string): boolean =>
  method === "POST" && pathname === "/api/v1/tasks";

async function escapeDialog(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

async function openQuickAdd(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(screen.getByRole("button", { name: "Quick add" }));
  return screen.findByRole("dialog", { name: "Quick add" });
}

describe("Quick add dialog session draft", () => {
  it.each([
    ["Escape", async (user: ReturnType<typeof userEvent.setup>) => user.keyboard("{Escape}")],
    [
      "the close button",
      async (user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) =>
        user.click(within(dialog).getByRole("button", { name: "Close" })),
    ],
    [
      "Cancel",
      async (user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) =>
        user.click(within(dialog).getByRole("button", { name: "Cancel" })),
    ],
  ])("restores the unsent title after dismissing with %s", async (_how, dismiss) => {
    const api = installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("link", { name: "Inbox" });

    let dialog = await openQuickAdd(user);
    expect(within(dialog).queryByText("Draft restored")).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Title"), "Call the dentist");
    await dismiss(user, dialog);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    dialog = await openQuickAdd(user);
    expect(within(dialog).getByLabelText("Title")).toHaveValue("Call the dentist");
    expect(within(dialog).getByText("Draft restored")).toBeVisible();
    expect(api.requests.some((r) => r.method === "POST" && r.url === "/api/v1/tasks")).toBe(false);
  });

  it("keeps the List and date the draft chose over the List the dialog reopens on", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 6, 3, 12));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const errands = fakeList("Errands");
    const home = fakeList("Home");
    const api = installFakeApi({ lists: [INBOX, errands, home] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "Home" }));

    let dialog = await openQuickAdd(user);
    await user.type(within(dialog).getByLabelText("Title"), "Fix the shelf");
    await user.click(within(dialog).getByRole("button", { name: "Details" }));
    await user.selectOptions(within(dialog).getByLabelText("List"), "Home");
    await user.click(within(dialog).getByRole("button", { name: "Tomorrow" }));
    await escapeDialog(user);

    await user.click(screen.getByRole("link", { name: "Errands" }));
    dialog = await openQuickAdd(user);
    const summary = within(dialog).getByRole("group", { name: "Summary" });
    expect(within(summary).getByText("Home")).toBeInTheDocument();
    expect(within(summary).queryByText("Errands")).not.toBeInTheDocument();
    expect(within(summary).getByText("Tomorrow")).toBeInTheDocument();
    expect(within(dialog).getByText("Draft restored")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toMatchObject({
      title: "Fix the shelf",
      list_id: home.id,
      due_date: "2026-07-04T00:00:00Z",
    });
  });

  it("files a draft that chose no List where the dialog reopens", async () => {
    const errands = fakeList("Errands");
    const api = installFakeApi({ lists: [INBOX, errands] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "Inbox" }));

    let dialog = await openQuickAdd(user);
    await user.type(within(dialog).getByLabelText("Title"), "Post parcel");
    await escapeDialog(user);

    await user.click(screen.getByRole("link", { name: "Errands" }));
    dialog = await openQuickAdd(user);
    await user.click(within(dialog).getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({ title: "Post parcel", list_id: errands.id });
  });

  it("offers Discard draft only once there is a draft, and discarding starts an empty form", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("link", { name: "Inbox" });

    let dialog = await openQuickAdd(user);
    expect(within(dialog).queryByRole("button", { name: "Discard draft" })).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Title"), "Call the dentist");
    await escapeDialog(user);

    dialog = await openQuickAdd(user);
    await user.click(within(dialog).getByRole("button", { name: "Discard draft" }));

    const title = within(dialog).getByLabelText("Title");
    expect(title).toHaveValue("");
    expect(title).toHaveFocus();
    expect(within(dialog).queryByText("Draft restored")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Discard draft" })).not.toBeInTheDocument();
    // Cancel is still there, and still only closes.
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    dialog = await openQuickAdd(user);
    expect(within(dialog).getByLabelText("Title")).toHaveValue("");
    expect(within(dialog).queryByText("Draft restored")).not.toBeInTheDocument();
  });

  it("clears the draft once it is saved as a Task", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("link", { name: "Inbox" });

    let dialog = await openQuickAdd(user);
    await user.type(within(dialog).getByLabelText("Title"), "Call the dentist");
    await escapeDialog(user);
    dialog = await openQuickAdd(user);
    await user.click(within(dialog).getByRole("button", { name: "Add task" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.tasks.filter((task) => task.title === "Call the dentist")).toHaveLength(1);

    dialog = await openQuickAdd(user);
    expect(within(dialog).getByLabelText("Title")).toHaveValue("");
    expect(within(dialog).queryByText("Draft restored")).not.toBeInTheDocument();
  });

  it("keeps the draft when the save fails", async () => {
    const api = installFakeApi();
    api.failWrite = isTaskCreate;
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("link", { name: "Inbox" });

    let dialog = await openQuickAdd(user);
    await user.type(within(dialog).getByLabelText("Title"), "Call the dentist");
    await user.click(within(dialog).getByRole("button", { name: "Add task" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Task not saved");
    await escapeDialog(user);

    api.failWrite = null;
    dialog = await openQuickAdd(user);
    expect(within(dialog).getByLabelText("Title")).toHaveValue("Call the dentist");
    expect(within(dialog).getByText("Draft restored")).toBeVisible();
  });

  it("still saves the Task when session storage throws", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Access denied", "SecurityError");
    });
    const api = installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("link", { name: "Inbox" });

    const dialog = await openQuickAdd(user);
    await user.type(within(dialog).getByLabelText("Title"), "Call the dentist");
    await user.click(within(dialog).getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.tasks.filter((task) => task.title === "Call the dentist")).toHaveLength(1);
  });
});
