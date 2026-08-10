import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { closestOrThrow, fakeDataTransfer } from "./test/dnd";
import { fakeFolder, fakeList, fakeTask, INBOX, installFakeApi } from "./test/fakeApi";

// Note: fetch stays stubbed across tests (each test installs a fresh fake).
// Restoring the real fetch between tests would let a late in-flight request
// from an unmounting App escape to the network and fail the run.

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function folderRowOf(name: string): HTMLElement {
  return closestOrThrow(screen.getByRole("button", { name }), ".folder-row");
}

describe("Collapsing a Folder", () => {
  it("collapses and expands a Folder's Lists from its chevron, independent of selection", async () => {
    const work = fakeFolder("Work");
    const backend = fakeList("Backend", { folder_id: work.id });
    installFakeApi({ folders: [work], lists: [INBOX, backend] });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: "Backend" });

    await user.click(screen.getByRole("button", { name: "Collapse folder Work" }));

    expect(screen.queryByRole("button", { name: "Backend" })).not.toBeInTheDocument();
    // The heading never changed — collapsing is not selecting.
    expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Expand folder Work" }));
    expect(screen.getByRole("button", { name: "Backend" })).toBeInTheDocument();
  });

  it("remembers a Folder's collapsed state across a reload, defaulting new Folders to expanded", async () => {
    const work = fakeFolder("Work");
    const home = fakeFolder("Home");
    const backend = fakeList("Backend", { folder_id: work.id });
    const chores = fakeList("Chores", { folder_id: home.id });
    installFakeApi({ folders: [work, home], lists: [INBOX, backend, chores] });
    const user = userEvent.setup();
    const first = render(<App />);
    await screen.findByRole("button", { name: "Backend" });

    await user.click(screen.getByRole("button", { name: "Collapse folder Work" }));
    first.unmount();

    installFakeApi({ folders: [work, home], lists: [INBOX, backend, chores] });
    render(<App />);

    expect(await screen.findByRole("button", { name: "Expand folder Work" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Backend" })).not.toBeInTheDocument();
    // Home was never collapsed — still expanded, same as any Folder created since.
    expect(screen.getByRole("button", { name: "Chores" })).toBeInTheDocument();
  });

  it("clicking a Folder's name selects it without the chevron toggling collapse", async () => {
    const work = fakeFolder("Work");
    const backend = fakeList("Backend", { folder_id: work.id });
    installFakeApi({ folders: [work], lists: [INBOX, backend] });
    const user = userEvent.setup();
    render(<App />);
    const sidebar = screen.getByRole("complementary");
    await within(sidebar).findByRole("button", { name: "Backend" });

    await user.click(within(sidebar).getByRole("button", { name: "Work" }));

    expect(await screen.findByRole("heading", { name: "Work", level: 1 })).toBeInTheDocument();
    // Selecting the Folder didn't collapse it.
    expect(within(sidebar).getByRole("button", { name: "Backend" })).toBeInTheDocument();
  });
});

describe("Empty Folder state", () => {
  it("shows an inline hint under a Folder with no Lists yet", async () => {
    const work = fakeFolder("Work");
    installFakeApi({ folders: [work] });
    render(<App />);

    expect(await screen.findByText(/no lists here yet/i)).toBeInTheDocument();
  });
});

describe("Folder drag and drop", () => {
  it("highlights a Folder when a List is dragged over it, and drops it in", async () => {
    const work = fakeFolder("Work");
    const groceries = fakeList("Groceries");
    const api = installFakeApi({ folders: [work], lists: [INBOX, groceries] });
    render(<App />);
    await screen.findByRole("button", { name: "Groceries" });

    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(
      closestOrThrow(screen.getByRole("button", { name: "Groceries" }), ".list-row"),
      { dataTransfer },
    );
    const folderRow = folderRowOf("Work");
    fireEvent.dragEnter(folderRow, { dataTransfer });
    expect(folderRow).toHaveClass("drag-over");

    fireEvent.drop(folderRow, { dataTransfer });
    expect(folderRow).not.toHaveClass("drag-over");

    const workLists = screen.getByRole("list", { name: "Lists in Work" });
    expect(await within(workLists).findByRole("button", { name: "Groceries" })).toBeInTheDocument();
    const patch = api.requests.find(
      (r) => r.method === "PATCH" && r.url === `/api/v1/lists/${groceries.id}`,
    );
    expect(patch?.body).toMatchObject({ folder_id: work.id });
  });

  it("refuses a Task dragged over a Folder: no highlight, and the drop does nothing", async () => {
    const work = fakeFolder("Work");
    const milk = fakeTask("Buy milk");
    const api = installFakeApi({ folders: [work], tasks: [milk] });
    render(<App />);
    await screen.findByText("Buy milk");

    const dataTransfer = fakeDataTransfer();
    const taskRow = closestOrThrow(screen.getByText("Buy milk"), "li");
    fireEvent.dragStart(taskRow, { dataTransfer });
    const folderRow = folderRowOf("Work");
    fireEvent.dragEnter(folderRow, { dataTransfer });

    expect(folderRow).not.toHaveClass("drag-over");

    fireEvent.drop(folderRow, { dataTransfer });
    // No List moved and no Task was patched — a Folder holds Lists, not Tasks.
    expect(
      api.requests.some((r) => r.method === "PATCH" && r.url === `/api/v1/tasks/${milk.id}`),
    ).toBe(false);
    expect(screen.getByText("Buy milk")).toBeInTheDocument();
  });

  it("auto-expands a collapsed Folder while a List is dragged over it, without selecting it", async () => {
    const work = fakeFolder("Work");
    const backend = fakeList("Backend", { folder_id: work.id });
    const groceries = fakeList("Groceries");
    installFakeApi({ folders: [work], lists: [INBOX, backend, groceries] });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: "Backend" });

    await user.click(screen.getByRole("button", { name: "Collapse folder Work" }));
    expect(screen.queryByRole("button", { name: "Backend" })).not.toBeInTheDocument();

    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(
      closestOrThrow(screen.getByRole("button", { name: "Groceries" }), ".list-row"),
      { dataTransfer },
    );
    const folderRow = folderRowOf("Work");
    fireEvent.dragEnter(folderRow, { dataTransfer });

    expect(screen.getByRole("button", { name: "Backend" })).toBeInTheDocument();
    // Still just a hover — the Folder was never selected/opened.
    expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();
  });
});

describe("Filing a List into a Folder without dragging", () => {
  it("offers a Folder field on the List form only once a Folder exists", async () => {
    const user = userEvent.setup();
    installFakeApi();
    const first = render(<App />);

    await user.click(await screen.findByRole("button", { name: "Create" }));
    await user.click(screen.getByRole("menuitem", { name: "New list" }));
    expect(screen.queryByLabelText("Folder")).not.toBeInTheDocument();
    first.unmount();

    const work = fakeFolder("Work");
    installFakeApi({ folders: [work] });
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Create" }));
    await user.click(screen.getByRole("menuitem", { name: "New list" }));
    expect(screen.getByLabelText("Folder")).toBeInTheDocument();
  });

  it("creates a List filed directly into a chosen Folder", async () => {
    const work = fakeFolder("Work");
    const api = installFakeApi({ folders: [work] });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Create" }));
    await user.click(screen.getByRole("menuitem", { name: "New list" }));
    await user.type(screen.getByLabelText("Name"), "Backend");
    await user.selectOptions(screen.getByLabelText("Folder"), "Work");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const workLists = await screen.findByRole("list", { name: "Lists in Work" });
    expect(within(workLists).getByRole("button", { name: "Backend" })).toBeInTheDocument();
    const created = api.lists.find((l) => l.name === "Backend");
    expect(created?.folder_id).toBe(work.id);
  });

  it("moves a List into a Folder by editing it, and back out again", async () => {
    const work = fakeFolder("Work");
    const backend = fakeList("Backend", { folder_id: work.id });
    const api = installFakeApi({ folders: [work], lists: [INBOX, backend] });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: "Backend" });

    await user.click(screen.getByRole("button", { name: "Edit Backend" }));
    expect(screen.getByLabelText("Folder")).toHaveValue(String(work.id));
    await user.selectOptions(screen.getByLabelText("Folder"), "No folder");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText(/no lists here yet/i);
    const workLists = screen.getByRole("list", { name: "Lists in Work" });
    expect(within(workLists).queryByRole("button", { name: "Backend" })).not.toBeInTheDocument();
    const patch = api.requests.find(
      (r) => r.method === "PATCH" && r.url === `/api/v1/lists/${backend.id}`,
    );
    expect(patch?.body).toMatchObject({ folder_id: null });
  });

  it("opens the List form pre-filed into a Folder from its 'New list' action", async () => {
    const work = fakeFolder("Work");
    installFakeApi({ folders: [work] });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "New list in Work" }));
    expect(screen.getByLabelText("Folder")).toHaveValue(String(work.id));
  });
});

describe("The Folder view", () => {
  it("groups Tasks across every List in the Folder under each List's own name", async () => {
    const work = fakeFolder("Work");
    const backend = fakeList("Backend", { folder_id: work.id });
    const frontend = fakeList("Frontend", { folder_id: work.id });
    const build = fakeTask("Fix build", { list_id: backend.id });
    const style = fakeTask("Fix styling", { list_id: frontend.id });
    const elsewhere = fakeTask("Unrelated", { list_id: INBOX.id });
    installFakeApi({
      folders: [work],
      lists: [INBOX, backend, frontend],
      tasks: [build, style, elsewhere],
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("button", { name: "Backend" });

    await user.click(screen.getByRole("button", { name: "Work" }));

    expect(await screen.findByRole("heading", { name: "Work" })).toBeInTheDocument();
    const backendGroup = screen.getByRole("list", { name: "Tasks in Backend" });
    expect(within(backendGroup).getByText("Fix build")).toBeInTheDocument();
    const frontendGroup = screen.getByRole("list", { name: "Tasks in Frontend" });
    expect(within(frontendGroup).getByText("Fix styling")).toBeInTheDocument();
    expect(screen.queryByText("Unrelated")).not.toBeInTheDocument();
  });

  it("navigates to a List from its group heading in the Folder view", async () => {
    const work = fakeFolder("Work");
    const backend = fakeList("Backend", { folder_id: work.id });
    installFakeApi({ folders: [work], lists: [INBOX, backend] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Work" }));
    await screen.findByRole("heading", { name: "Work", level: 1 });

    const main = document.querySelector("main");
    if (main === null) {
      throw new Error("main not found");
    }
    await user.click(within(main).getByRole("button", { name: "Backend" }));

    // The List belongs to Work, so its own header now shows the breadcrumb.
    const heading = await screen.findByRole("heading", { level: 1 });
    await waitFor(() => expect(heading).toHaveTextContent("Work / Backend"));
  });

  it("completes a Task from the Folder view", async () => {
    const work = fakeFolder("Work");
    const backend = fakeList("Backend", { folder_id: work.id });
    const build = fakeTask("Fix build", { list_id: backend.id });
    const api = installFakeApi({ folders: [work], lists: [INBOX, backend], tasks: [build] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Work" }));

    await user.click(await screen.findByRole("checkbox", { name: "Complete Fix build" }));

    const patch = api.requests.find(
      (r) => r.method === "PATCH" && r.url === `/api/v1/tasks/${build.id}`,
    );
    expect(patch?.body).toEqual({ completed: true });
  });

  it("files Quick add inside the Folder view to the Folder's first List, naming it in the placeholder", async () => {
    const work = fakeFolder("Work");
    const backend = fakeList("Backend", { folder_id: work.id, sort_order: 1 });
    const frontend = fakeList("Frontend", { folder_id: work.id, sort_order: 2 });
    const api = installFakeApi({ folders: [work], lists: [INBOX, backend, frontend] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Work" }));

    const input = await screen.findByPlaceholderText("Add a task to Backend…");
    await user.type(input, "Ship it{enter}");

    const post = await waitFor(() => {
      const request = api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/tasks");
      expect(request).toBeDefined();
      return request;
    });
    expect(post?.body).toMatchObject({ title: "Ship it", list_id: backend.id });
  });

  it("shows an empty-Folder message in the Folder view instead of a bare heading", async () => {
    const work = fakeFolder("Work");
    installFakeApi({ folders: [work] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Work" }));

    expect(await screen.findByText(/has no lists yet/i)).toBeInTheDocument();
  });
});

describe("Breadcrumb", () => {
  it("shows 'Folder / List' in the header for a List filed in a Folder, navigating to the Folder", async () => {
    const work = fakeFolder("Work");
    const backend = fakeList("Backend", { folder_id: work.id });
    installFakeApi({ folders: [work], lists: [INBOX, backend] });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Backend" }));
    const heading = await screen.findByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Work / Backend");

    await user.click(within(heading).getByRole("button", { name: "Work" }));
    expect(await screen.findByRole("heading", { name: "Work" })).toBeInTheDocument();
  });

  it("shows a bare List name with no breadcrumb when the List has no Folder", async () => {
    installFakeApi({ lists: [INBOX, fakeList("Groceries")] });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Groceries" }));
    const heading = await screen.findByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Groceries");
    expect(within(heading).queryByRole("button")).not.toBeInTheDocument();
  });
});
