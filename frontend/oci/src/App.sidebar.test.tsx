import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { closestOrThrow, fakeDataTransfer } from "./test/dnd";
import { fakeFolder, fakeList, fakeTask, INBOX, installFakeApi } from "./test/fakeApi";

/** fakeTask() defaults to INBOX; delete confirmations name a task count for
 * the List actually being deleted, so these helpers stamp the right list_id. */
function tasksIn(listId: number, count: number): ReturnType<typeof fakeTask>[] {
  return Array.from({ length: count }, (_, i) => fakeTask(`Task ${i + 1}`, { list_id: listId }));
}

// Note: fetch stays stubbed across tests (each test installs a fresh fake).
// Restoring the real fetch between tests would let a late in-flight request
// from an unmounting App escape to the network and fail the run.
afterEach(() => {
  vi.restoreAllMocks();
});

describe("Sidebar structure", () => {
  it("shows Inbox first, then folders with their lists, then loose lists", async () => {
    const work = fakeFolder("Work");
    installFakeApi({
      folders: [work],
      lists: [
        INBOX,
        fakeList("Groceries", { emoji: "🛒" }),
        fakeList("Backend", { folder_id: work.id }),
      ],
    });

    render(<App />);

    const nav = await screen.findByRole("navigation", { name: "Lists" });
    const workLists = await within(nav).findByRole("list", { name: "Lists in Work" });
    expect(within(workLists).getByRole("button", { name: "Backend" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "🛒 Groceries" })).toBeInTheDocument();
    const buttons = within(nav).getAllByRole("button", { name: /^(Inbox|Backend|🛒 Groceries)$/ });
    expect(buttons[0]).toHaveAccessibleName("Inbox");
  });

  it("shows the app version as a tooltip on the brand wordmark", async () => {
    installFakeApi();
    render(<App />);

    // Nothing sets VITE_APP_VERSION in the suite, so it falls back to "dev".
    expect(await screen.findByText("Tuk Tuk")).toHaveAttribute("title", "tuk-tuk version dev");
  });

  it("shows a Lists heading with a single Create control, and no bottom-pinned add buttons", async () => {
    installFakeApi();
    render(<App />);

    const nav = await screen.findByRole("navigation", { name: "Lists" });
    expect(within(nav).getByRole("heading", { name: "Lists" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "Create" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add List" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Folder" })).not.toBeInTheDocument();
  });

  it("with zero Folders, no Folder row or Folder heading appears anywhere", async () => {
    installFakeApi({ lists: [INBOX, fakeList("Groceries")] });
    render(<App />);

    await screen.findByRole("button", { name: "Groceries" });
    expect(screen.queryByText(/folder/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /folder/i })).not.toBeInTheDocument();
  });

  it("the Create menu opens New list and New folder, reachable by keyboard", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);

    const trigger = await screen.findByRole("button", { name: "Create" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    await user.click(trigger);

    const menu = screen.getByRole("menu", { name: "Create" });
    expect(within(menu).getByRole("menuitem", { name: "New list" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "New folder" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu", { name: "Create" })).not.toBeInTheDocument();
  });

  it("shows a Folder's open-Task count — the sum of its Lists — and nothing when zero", async () => {
    const work = fakeFolder("Work");
    const empty = fakeFolder("Empty");
    const backend = fakeList("Backend", { folder_id: work.id });
    const frontend = fakeList("Frontend", { folder_id: work.id });
    installFakeApi({
      folders: [work, empty],
      lists: [INBOX, backend, frontend],
      tasks: [
        ...tasksIn(backend.id, 2),
        ...tasksIn(frontend.id, 1),
        fakeTask("done", { list_id: backend.id, completed: true }),
      ],
    });

    render(<App />);
    await screen.findByText("Work");

    // 2 open in Backend + 1 open in Frontend; the completed one does not count.
    const workRow = folderRowOf("Work");
    expect(within(workRow).getByText("3")).toBeInTheDocument();
    // Zero renders as nothing, not "0".
    const emptyRow = folderRowOf("Empty");
    expect(within(emptyRow).queryByText("0")).not.toBeInTheDocument();
    expect(emptyRow.querySelector(".folder-count")).toBeNull();
  });
});

describe("List management", () => {
  it("creates a List with name, color, and emoji from the Add List form", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Create" }));
    await user.click(screen.getByRole("menuitem", { name: "New list" }));
    await user.type(screen.getByLabelText("Name"), "Groceries");
    fireEvent.change(screen.getByLabelText("Color"), { target: { value: "#ff9800" } });
    await user.type(screen.getByLabelText("Emoji"), "🛒");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const nav = screen.getByRole("navigation", { name: "Lists" });
    expect(await within(nav).findByRole("button", { name: "🛒 Groceries" })).toBeInTheDocument();
    const post = api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/lists");
    expect(post?.body).toEqual({ name: "Groceries", color: "#ff9800", emoji: "🛒" });
  });

  it("creates a List with an emoji chosen from the picker", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Create" }));
    await user.click(screen.getByRole("menuitem", { name: "New list" }));
    await user.type(screen.getByLabelText("Name"), "Groceries");

    await user.click(screen.getByRole("button", { name: "Choose emoji" }));
    const picker = await screen.findByRole("dialog", { name: "Choose an emoji" });
    await user.click(within(picker).getByRole("button", { name: "shopping cart" }));

    await user.click(screen.getByRole("button", { name: "Save" }));

    const post = await waitFor(() => {
      const request = api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/lists");
      expect(request).toBeDefined();
      return request;
    });
    expect(post?.body).toMatchObject({ name: "Groceries", emoji: "🛒" });
  });

  it("edits a List's name from the sidebar, keeping color and emoji", async () => {
    const groceries = fakeList("Groceries", { color: "#ff9800", emoji: "🛒" });
    const api = installFakeApi({ lists: [INBOX, groceries] });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Edit Groceries" }));
    const nameInput = screen.getByLabelText("Name");
    expect(nameInput).toHaveValue("Groceries");
    await user.clear(nameInput);
    await user.type(nameInput, "Food");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("button", { name: "🛒 Food" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "🛒 Groceries" })).not.toBeInTheDocument();
    const patch = api.requests.find(
      (r) => r.method === "PATCH" && r.url === `/api/v1/lists/${groceries.id}`,
    );
    expect(patch?.body).toEqual({ name: "Food", color: "#ff9800", emoji: "🛒" });
  });

  it("replaces and removes an existing List's emoji from the picker", async () => {
    const groceries = fakeList("Groceries", { color: "#ff9800", emoji: "🛒" });
    const api = installFakeApi({ lists: [INBOX, groceries] });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Edit Groceries" }));
    await user.click(screen.getByRole("button", { name: "Choose emoji" }));
    await user.click(
      within(await screen.findByRole("dialog", { name: "Choose an emoji" })).getByRole("button", {
        name: "briefcase",
      }),
    );
    expect(screen.queryByRole("dialog", { name: "Choose an emoji" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Emoji")).toHaveValue("💼");

    await user.click(screen.getByRole("button", { name: "Choose emoji" }));
    await user.click(
      within(await screen.findByRole("dialog", { name: "Choose an emoji" })).getByRole("button", {
        name: "No emoji",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patch = api.requests.find(
        (r) => r.method === "PATCH" && r.url === `/api/v1/lists/${groceries.id}`,
      );
      expect(patch?.body).toMatchObject({ emoji: null });
    });
  });

  it("archiving a List moves it to the Archived section until unarchived", async () => {
    const side = fakeList("Side project");
    const api = installFakeApi({ lists: [INBOX, side] });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Archive Side project" }));

    const nav = screen.getByRole("navigation", { name: "Lists" });
    expect(within(nav).queryByRole("button", { name: "Side project" })).not.toBeInTheDocument();
    const archived = await screen.findByRole("region", { name: "Archived" });
    expect(within(archived).getByText("Side project")).toBeInTheDocument();

    await user.click(within(archived).getByRole("button", { name: "Unarchive Side project" }));

    expect(await within(nav).findByRole("button", { name: "Side project" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Archived" })).not.toBeInTheDocument();
    const patches = api.requests.filter((r) => r.method === "PATCH").map((r) => r.body);
    expect(patches).toEqual([{ is_archived: true }, { is_archived: false }]);
  });

  it("shows the originating Folder beside an archived List that belonged to one", async () => {
    const work = fakeFolder("Work");
    const backend = fakeList("Backend", { folder_id: work.id });
    const api = installFakeApi({ folders: [work], lists: [INBOX, backend] });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Archive Backend" }));

    const archived = await screen.findByRole("region", { name: "Archived" });
    expect(within(archived).getByText("Work")).toBeInTheDocument();
    expect(within(archived).getByLabelText("In folder Work")).toBeInTheDocument();

    await user.click(within(archived).getByRole("button", { name: "Unarchive Backend" }));

    const nav = screen.getByRole("navigation", { name: "Lists" });
    const workLists = await within(nav).findByRole("list", { name: "Lists in Work" });
    expect(within(workLists).getByRole("button", { name: "Backend" })).toBeInTheDocument();
    const patches = api.requests.filter((r) => r.method === "PATCH").map((r) => r.body);
    expect(patches).toEqual([{ is_archived: true }, { is_archived: false }]);
  });

  it("shows no Folder byline for an archived List that belonged to no Folder", async () => {
    const side = fakeList("Side project");
    installFakeApi({ lists: [INBOX, side] });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Archive Side project" }));

    const archived = await screen.findByRole("region", { name: "Archived" });
    expect(within(archived).getByText("Side project")).toBeInTheDocument();
    expect(within(archived).queryByLabelText(/^In folder /)).not.toBeInTheDocument();
  });

  it("deletes a List only after confirmation, naming how many Tasks are destroyed", async () => {
    const side = fakeList("Side project");
    const api = installFakeApi({ lists: [INBOX, side], tasks: tasksIn(side.id, 3) });
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Delete list Side project" }));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(confirmSpy.mock.calls[0]![0]).toMatch(/3 tasks/i);
    expect(screen.getByRole("button", { name: "Side project" })).toBeInTheDocument();
    expect(api.requests.some((r) => r.method === "DELETE")).toBe(false);

    confirmSpy.mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Delete list Side project" }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Side project" })).not.toBeInTheDocument(),
    );
    expect(
      api.requests.some((r) => r.method === "DELETE" && r.url === `/api/v1/lists/${side.id}`),
    ).toBe(true);
  });

  it("names a single Task in the singular when deleting a List with exactly one", async () => {
    const side = fakeList("Side project");
    installFakeApi({ lists: [INBOX, side], tasks: tasksIn(side.id, 1) });
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Delete list Side project" }));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(confirmSpy.mock.calls[0]![0]).toMatch(/1 task\b/i);
    expect(confirmSpy.mock.calls[0]![0]).not.toMatch(/1 tasks/i);
  });

  it("names zero Tasks when deleting an empty List", async () => {
    const side = fakeList("Side project");
    installFakeApi({ lists: [INBOX, side] });
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Delete list Side project" }));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(confirmSpy.mock.calls[0]![0]).toMatch(/no tasks/i);
  });
});

describe("Folder management", () => {
  it("creates a Folder from the Add Folder form", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Create" }));
    await user.click(screen.getByRole("menuitem", { name: "New folder" }));
    await user.type(screen.getByLabelText("Folder name"), "Work");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("list", { name: "Lists in Work" })).toBeInTheDocument();
    const post = api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/folders");
    expect(post?.body).toEqual({ name: "Work" });
  });

  it("renames a Folder in place", async () => {
    const work = fakeFolder("Wrok");
    const api = installFakeApi({ folders: [work] });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Rename folder Wrok" }));
    const input = screen.getByLabelText("Folder name");
    expect(input).toHaveValue("Wrok");
    await user.clear(input);
    await user.type(input, "Work");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("list", { name: "Lists in Work" })).toBeInTheDocument();
    const patch = api.requests.find(
      (r) => r.method === "PATCH" && r.url === `/api/v1/folders/${work.id}`,
    );
    expect(patch?.body).toEqual({ name: "Work" });
  });

  it("deleting a Folder keeps its Lists, ungrouped, and confirms no Tasks are lost", async () => {
    const work = fakeFolder("Work");
    const backend = fakeList("Backend", { folder_id: work.id });
    const api = installFakeApi({ folders: [work], lists: [INBOX, backend] });
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Delete folder Work" }));

    expect(confirmSpy.mock.calls[0]![0]).toMatch(/top level/i);
    expect(confirmSpy.mock.calls[0]![0]).toMatch(/no tasks (are )?deleted|nothing is deleted/i);
    await waitFor(() =>
      expect(screen.queryByRole("list", { name: "Lists in Work" })).not.toBeInTheDocument(),
    );
    const nav = screen.getByRole("navigation", { name: "Lists" });
    expect(within(nav).getByRole("button", { name: "Backend" })).toBeInTheDocument();
    expect(
      api.requests.some((r) => r.method === "DELETE" && r.url === `/api/v1/folders/${work.id}`),
    ).toBe(true);
  });

  it("cancelling a Folder deletion leaves the Folder and its Lists untouched", async () => {
    const work = fakeFolder("Work");
    const backend = fakeList("Backend", { folder_id: work.id });
    const api = installFakeApi({ folders: [work], lists: [INBOX, backend] });
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Delete folder Work" }));

    expect(await screen.findByRole("list", { name: "Lists in Work" })).toBeInTheDocument();
    expect(api.requests.some((r) => r.method === "DELETE")).toBe(false);
  });
});

function rowOf(button: HTMLElement): HTMLElement {
  return closestOrThrow(button, ".list-row");
}

function folderRowOf(name: string): HTMLElement {
  return closestOrThrow(screen.getByText(name), ".folder-row");
}

describe("Sidebar drag and drop", () => {
  it("dragging a list onto another list inserts it before the target", async () => {
    const alpha = fakeList("Alpha", { sort_order: 1024 });
    const beta = fakeList("Beta", { sort_order: 2048 });
    const gamma = fakeList("Gamma", { sort_order: 3072 });
    const api = installFakeApi({ lists: [INBOX, alpha, beta, gamma] });
    render(<App />);
    await screen.findByRole("button", { name: "Gamma" });

    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(rowOf(screen.getByRole("button", { name: "Gamma" })), { dataTransfer });
    fireEvent.drop(rowOf(screen.getByRole("button", { name: "Beta" })), { dataTransfer });

    const nav = screen.getByRole("navigation", { name: "Lists" });
    await waitFor(() => {
      const names = within(nav)
        .getAllByRole("button", { name: /^(Inbox|Alpha|Beta|Gamma)$/ })
        .map((button) => button.textContent);
      expect(names).toEqual(["Inbox", "Alpha", "Gamma", "Beta"]);
    });
    const patch = api.requests.find(
      (r) => r.method === "PATCH" && r.url === `/api/v1/lists/${gamma.id}`,
    );
    expect(patch?.body).toEqual({ folder_id: null, sort_order: 1536 });
  });

  it("reordering into an exhausted gap renumbers the group instead of colliding", async () => {
    const alpha = fakeList("Alpha", { sort_order: 1000 });
    const beta = fakeList("Beta", { sort_order: 1001 });
    const gamma = fakeList("Gamma", { sort_order: 3000 });
    const api = installFakeApi({ lists: [INBOX, alpha, beta, gamma] });
    render(<App />);
    await screen.findByRole("button", { name: "Gamma" });

    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(rowOf(screen.getByRole("button", { name: "Gamma" })), { dataTransfer });
    fireEvent.drop(rowOf(screen.getByRole("button", { name: "Beta" })), { dataTransfer });

    const nav = screen.getByRole("navigation", { name: "Lists" });
    await waitFor(() => {
      const names = within(nav)
        .getAllByRole("button", { name: /^(Inbox|Alpha|Beta|Gamma)$/ })
        .map((button) => button.textContent);
      expect(names).toEqual(["Inbox", "Alpha", "Gamma", "Beta"]);
    });
    // Persisted state must carry the same order with no duplicate sort_order values.
    const stored = api.lists
      .filter((list) => !list.is_inbox)
      .sort((a, b) => a.sort_order - b.sort_order);
    expect(stored.map((list) => list.name)).toEqual(["Alpha", "Gamma", "Beta"]);
    expect(new Set(stored.map((list) => list.sort_order)).size).toBe(stored.length);
  });

  it("dragging a list onto a folder header moves it into that folder", async () => {
    const work = fakeFolder("Work");
    const backend = fakeList("Backend", { folder_id: work.id, sort_order: 1024 });
    const groceries = fakeList("Groceries", { sort_order: 5000 });
    const api = installFakeApi({ folders: [work], lists: [INBOX, backend, groceries] });
    render(<App />);
    await screen.findByRole("button", { name: "Groceries" });

    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(rowOf(screen.getByRole("button", { name: "Groceries" })), {
      dataTransfer,
    });
    const folderRow = screen.getByText("Work").closest(".folder-row");
    if (!(folderRow instanceof HTMLElement)) {
      throw new Error("folder row not found");
    }
    fireEvent.drop(folderRow, { dataTransfer });

    const workLists = screen.getByRole("list", { name: "Lists in Work" });
    expect(await within(workLists).findByRole("button", { name: "Groceries" })).toBeInTheDocument();
    const patch = api.requests.find(
      (r) => r.method === "PATCH" && r.url === `/api/v1/lists/${groceries.id}`,
    );
    expect(patch?.body).toEqual({ folder_id: work.id, sort_order: 2048 });
  });

  it("dragging a list out of a folder onto a loose list ungroups it", async () => {
    const work = fakeFolder("Work");
    const backend = fakeList("Backend", { folder_id: work.id, sort_order: 1024 });
    const groceries = fakeList("Groceries", { sort_order: 2048 });
    const api = installFakeApi({ folders: [work], lists: [INBOX, backend, groceries] });
    render(<App />);
    await screen.findByRole("button", { name: "Backend" });

    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(rowOf(screen.getByRole("button", { name: "Backend" })), { dataTransfer });
    fireEvent.drop(rowOf(screen.getByRole("button", { name: "Groceries" })), { dataTransfer });

    const workLists = screen.getByRole("list", { name: "Lists in Work" });
    await waitFor(() =>
      expect(within(workLists).queryByRole("button", { name: "Backend" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("navigation", { name: "Lists" })).toContainElement(
      screen.getByRole("button", { name: "Backend" }),
    );
    const patch = api.requests.find(
      (r) => r.method === "PATCH" && r.url === `/api/v1/lists/${backend.id}`,
    );
    expect(patch?.body).toEqual({ folder_id: null, sort_order: 1024 });
  });

  it("dragging a list onto empty sidebar space ungroups it even with no loose lists", async () => {
    const work = fakeFolder("Work");
    const backend = fakeList("Backend", { folder_id: work.id, sort_order: 1024 });
    const api = installFakeApi({ folders: [work], lists: [INBOX, backend] });
    render(<App />);
    await screen.findByRole("button", { name: "Backend" });

    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(rowOf(screen.getByRole("button", { name: "Backend" })), { dataTransfer });
    fireEvent.drop(screen.getByRole("navigation", { name: "Lists" }), { dataTransfer });

    const workLists = screen.getByRole("list", { name: "Lists in Work" });
    await waitFor(() =>
      expect(within(workLists).queryByRole("button", { name: "Backend" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("navigation", { name: "Lists" })).toContainElement(
      screen.getByRole("button", { name: "Backend" }),
    );
    const patch = api.requests.find(
      (r) => r.method === "PATCH" && r.url === `/api/v1/lists/${backend.id}`,
    );
    expect(patch?.body).toEqual({ folder_id: null, sort_order: 1024 });
  });

  it("dragging a task onto a sidebar list moves it there and back", async () => {
    const groceries = fakeList("Groceries");
    const milk = fakeTask("Buy milk");
    const api = installFakeApi({ lists: [INBOX, groceries], tasks: [milk] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Inbox" }));
    await screen.findByText("Buy milk");

    const dataTransfer = fakeDataTransfer();
    const taskRow = screen.getByText("Buy milk").closest("li");
    if (!(taskRow instanceof HTMLElement)) {
      throw new Error("task row not found");
    }
    fireEvent.dragStart(taskRow, { dataTransfer });
    fireEvent.drop(rowOf(screen.getByRole("button", { name: "Groceries" })), { dataTransfer });

    await waitFor(() => expect(screen.queryByText("Buy milk")).not.toBeInTheDocument());
    const patch = api.requests.find(
      (r) => r.method === "PATCH" && r.url === `/api/v1/tasks/${milk.id}`,
    );
    expect(patch?.body).toEqual({ list_id: groceries.id });

    await user.click(screen.getByRole("button", { name: "Groceries" }));
    const milkInGroceries = await screen.findByText("Buy milk");

    const back = fakeDataTransfer();
    const groceriesTaskRow = milkInGroceries.closest("li");
    if (!(groceriesTaskRow instanceof HTMLElement)) {
      throw new Error("task row not found");
    }
    fireEvent.dragStart(groceriesTaskRow, { dataTransfer: back });
    fireEvent.drop(rowOf(screen.getByRole("button", { name: "Inbox" })), { dataTransfer: back });

    await waitFor(() => expect(screen.queryByText("Buy milk")).not.toBeInTheDocument());
    expect(api.tasks.find((t) => t.id === milk.id)?.list_id).toBe(INBOX.id);
  });

  it("dragging a folder onto another folder reorders them", async () => {
    const work = fakeFolder("Work", { sort_order: 1024 });
    const home = fakeFolder("Home", { sort_order: 2048 });
    const api = installFakeApi({ folders: [work, home] });
    render(<App />);
    await screen.findByText("Home");

    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(folderRowOf("Home"), { dataTransfer });
    fireEvent.drop(folderRowOf("Work"), { dataTransfer });

    const nav = screen.getByRole("navigation", { name: "Lists" });
    await waitFor(() => {
      const names = within(nav)
        .getAllByText(/^(Work|Home)$/)
        .map((el) => el.textContent);
      expect(names).toEqual(["Home", "Work"]);
    });
    const patch = api.requests.find(
      (r) => r.method === "PATCH" && r.url === `/api/v1/folders/${home.id}`,
    );
    expect(patch?.body).toEqual({ sort_order: 0 });
  });
});

describe("Inbox protections", () => {
  it("offers no edit, archive, delete, or drag affordances on the Inbox", async () => {
    installFakeApi({ lists: [INBOX, fakeList("Groceries")] });
    render(<App />);
    await screen.findByRole("button", { name: "Groceries" });

    expect(screen.queryByRole("button", { name: "Edit Inbox" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive Inbox" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete list Inbox" })).not.toBeInTheDocument();
    expect(rowOf(screen.getByRole("button", { name: "Inbox" }))).not.toHaveAttribute(
      "draggable",
      "true",
    );
    expect(screen.getByRole("button", { name: "Edit Groceries" })).toBeInTheDocument();
    expect(rowOf(screen.getByRole("button", { name: "Groceries" }))).toHaveAttribute(
      "draggable",
      "true",
    );
  });
});
