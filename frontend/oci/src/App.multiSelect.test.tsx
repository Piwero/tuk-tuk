import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeList, fakeTask, installFakeApi, INBOX } from "./test/fakeApi";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function tick(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** Opens the Inbox list and returns its task rows in visible order. */
async function openInboxRows(): Promise<HTMLElement[]> {
  fireEvent.click(await screen.findByRole("button", { name: "Inbox" }));
  await screen.findByRole("combobox", { name: "Add a task" });
  const list = screen.getByRole("list", { name: "Tasks" });
  return within(list).getAllByRole("listitem");
}

function rowFor(title: string): HTMLElement {
  const button = screen.getByRole("button", { name: `Open details for ${title}` });
  const li = button.closest("li");
  if (li === null) {
    throw new Error(`no row for ${title}`);
  }
  return li;
}

function mark(title: string, shiftKey = false): void {
  const row = rowFor(title);
  row.focus();
  fireEvent.keyDown(row, { key: "x", shiftKey });
}

describe("multi-select and bulk actions", () => {
  it("Shift extends the selection across the visible range", async () => {
    installFakeApi({
      tasks: ["A", "B", "C", "D"].map((title) => fakeTask(title)),
    });
    render(<App />);
    await openInboxRows();

    mark("A");
    mark("C", true);

    expect(screen.getByRole("toolbar", { name: "Bulk actions" })).toHaveTextContent("3 selected");
    expect(rowFor("B")).toHaveAttribute("data-selected", "true");
    expect(rowFor("D")).not.toHaveAttribute("data-selected");
  });

  it("Escape clears the selection", async () => {
    installFakeApi({ tasks: [fakeTask("A"), fakeTask("B")] });
    render(<App />);
    await openInboxRows();

    mark("A");
    expect(screen.getByRole("toolbar", { name: "Bulk actions" })).toBeInTheDocument();
    fireEvent.keyDown(rowFor("A"), { key: "Escape" });

    expect(screen.queryByRole("toolbar", { name: "Bulk actions" })).not.toBeInTheDocument();
  });

  it("completes every selected Task, one PATCH each on the per-Task endpoint", async () => {
    const api = installFakeApi({ tasks: [fakeTask("A"), fakeTask("B"), fakeTask("C")] });
    render(<App />);
    await openInboxRows();

    mark("A");
    mark("B", true);
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));

    // Deferred behind the same window a single completion uses.
    expect(api.requests.filter((r) => r.method === "PATCH")).toHaveLength(0);
    tick(6_000);

    await waitFor(() => {
      expect(api.tasks.find((t) => t.title === "A")?.completed).toBe(true);
      expect(api.tasks.find((t) => t.title === "B")?.completed).toBe(true);
    });
    expect(api.tasks.find((t) => t.title === "C")?.completed).toBe(false);
    expect(
      api.requests.filter((r) => r.method === "PATCH" && r.url.startsWith("/api/v1/tasks/")),
    ).toHaveLength(2);
  });

  it("deletes a selection as one undoable action", async () => {
    const api = installFakeApi({ tasks: [fakeTask("A"), fakeTask("B"), fakeTask("Keep")] });
    render(<App />);
    await openInboxRows();

    mark("A");
    mark("B", true);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.queryByText("A")).not.toBeInTheDocument();
    expect(screen.queryByText("B")).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));

    expect(await screen.findByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(api.requests.some((r) => r.method === "DELETE")).toBe(false);
  });

  it("keeps the successes and names the failures on a partial failure", async () => {
    const api = installFakeApi({
      tasks: [fakeTask("Alpha"), fakeTask("Bravo"), fakeTask("Charlie")],
    });
    const bravoId = api.tasks.find((t) => t.title === "Bravo")!.id;
    const passthrough = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes(`/api/v1/tasks/${bravoId}`) && init?.method === "PATCH") {
        return new Response(JSON.stringify({ error: { code: "boom", message: "no" } }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      return passthrough(input as string, init);
    });

    render(<App />);
    await openInboxRows();
    mark("Alpha");
    mark("Charlie", true);
    // Charlie's range spans Bravo too.
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    tick(6_000);

    await waitFor(() => {
      expect(api.tasks.find((t) => t.title === "Alpha")?.completed).toBe(true);
      expect(api.tasks.find((t) => t.title === "Charlie")?.completed).toBe(true);
    });
    expect(api.tasks.find((t) => t.title === "Bravo")?.completed).toBe(false);
    await waitFor(() => expect(screen.getByText(/Couldn't complete: Bravo/)).toBeInTheDocument());
  });

  it("moves a selection to another List, one PATCH each, undoable", async () => {
    const api = installFakeApi({
      lists: [INBOX, fakeList("Archive box", { id: 12 })],
      tasks: [fakeTask("A"), fakeTask("B")],
    });
    render(<App />);
    await openInboxRows();

    mark("A");
    mark("B", true);
    fireEvent.click(screen.getByRole("button", { name: "Move to List" }));
    const dialog = await screen.findByRole("dialog", { name: "Move selected Tasks" });
    fireEvent.change(within(dialog).getByLabelText("List"), { target: { value: "12" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Move" }));
    tick(6_000);

    await waitFor(() => {
      expect(api.tasks.find((t) => t.title === "A")?.list_id).toBe(12);
      expect(api.tasks.find((t) => t.title === "B")?.list_id).toBe(12);
    });
  });

  it("clears the selection on a view change", async () => {
    installFakeApi({ tasks: [fakeTask("A"), fakeTask("B")] });
    render(<App />);
    await openInboxRows();
    mark("A");
    expect(screen.getByRole("toolbar", { name: "Bulk actions" })).toBeInTheDocument();

    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Smart Lists" })).getByRole("button", {
        name: "All",
      }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("toolbar", { name: "Bulk actions" })).not.toBeInTheDocument(),
    );
  });
});
