import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeCheckItem, fakeList, fakeTag, fakeTask, INBOX, installFakeApi } from "./test/fakeApi";

// The search field is debounced (issue #167) — every test here pins the
// clock so the debounce window can be crossed deterministically, the same
// convention App.taskUndo.test.tsx uses for its own timed window.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

function tick(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** Navigates to /search if not already there, then finds its own field —
 * distinct from the sidebar's "Quick search" jump box. */
async function openSearch(): Promise<HTMLElement> {
  const heading = screen.queryByRole("heading", { name: "Search" });
  if (heading === null) {
    const nav = await screen.findByRole("navigation", { name: "Views" });
    fireEvent.click(within(nav).getByRole("link", { name: "Search" }));
    await screen.findByRole("heading", { name: "Search" });
  }
  return screen.findByRole("searchbox", { name: "Search tasks" });
}

/** Types a query into the page's own field and lets the debounce settle,
 * without ever pressing Enter. */
async function searchFor(query: string): Promise<void> {
  const box = await openSearch();
  fireEvent.change(box, { target: { value: query } });
  tick(500);
  await Promise.resolve();
}

const searchRequests = (api: { requests: { method: string; url: string }[] }): string[] =>
  api.requests
    .filter((request) => request.method === "GET" && request.url.includes("search="))
    .map((request) => request.url);

describe("Search", () => {
  it("has its own field on the page, focused on arrival", async () => {
    installFakeApi();
    render(<App />);

    const box = await openSearch();
    expect(box).toHaveFocus();
  });

  it("updates results as you type, debounced, without pressing Enter", async () => {
    const api = installFakeApi({ tasks: [fakeTask("Buy groceries")] });
    render(<App />);

    const box = await openSearch();
    fireEvent.change(box, { target: { value: "groceries" } });

    // Comfortably inside the debounce window: no fetch, no result yet.
    tick(150);
    expect(searchRequests(api)).toEqual([]);
    expect(
      screen.queryByRole("button", { name: "Open details for Buy groceries" }),
    ).not.toBeInTheDocument();

    // Past the window: the query landed on its own, with no Enter involved.
    tick(200);
    await waitFor(() => expect(searchRequests(api).length).toBeGreaterThan(0));
    expect(
      await screen.findByRole("button", { name: "Open details for Buy groceries" }),
    ).toBeInTheDocument();
  });

  it("matches titles, descriptions and Check Item titles, case-insensitively", async () => {
    installFakeApi({
      tasks: [
        fakeTask("Buy groceries"),
        fakeTask("Errand", { description: "pick up the dry GROCERIES order" }),
        fakeTask("Pack bags", { check_items: [fakeCheckItem("groceries for the trip")] }),
        fakeTask("Write report"),
      ],
    });
    render(<App />);

    await searchFor("Groceries");

    expect(
      await screen.findByRole("button", { name: "Open details for Buy groceries" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open details for Errand" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open details for Pack bags" })).toBeInTheDocument();
    expect(screen.queryByText("Write report")).not.toBeInTheDocument();
  });

  it("highlights the matched substring in a result's title", async () => {
    installFakeApi({ tasks: [fakeTask("Buy Groceries today")] });
    render(<App />);

    await searchFor("groceries");

    const row = (
      await screen.findByRole("button", { name: "Open details for Buy Groceries today" })
    ).closest("li");
    if (row === null) {
      throw new Error("row not found");
    }
    const mark = row.querySelector("mark");
    // Case is preserved from the title, not the (lowercase) typed query.
    expect(mark?.textContent).toBe("Groceries");
    expect(row.querySelector(".task-title")?.textContent).toContain("Buy Groceries today");
  });

  it("does not highlight anything when the title itself has no match", async () => {
    installFakeApi({
      tasks: [fakeTask("Errand", { description: "pick up the dry groceries order" })],
    });
    render(<App />);

    await searchFor("groceries");

    const row = (await screen.findByRole("button", { name: "Open details for Errand" })).closest(
      "li",
    );
    expect(row?.querySelector("mark")).toBeNull();
  });

  it("shows a result count, pluralized", async () => {
    installFakeApi({ tasks: [fakeTask("Report one"), fakeTask("Report two")] });
    render(<App />);

    await searchFor("report");
    expect(await screen.findByText("2 results")).toBeInTheDocument();
  });

  it("shows a singular count for a single match", async () => {
    installFakeApi({ tasks: [fakeTask("Report one")] });
    render(<App />);

    await searchFor("report");
    expect(await screen.findByText("1 result")).toBeInTheDocument();
  });

  it("narrows by List, Tag, Priority and completion, combined", async () => {
    const work = fakeTag("work");
    const project = fakeList("Project");
    installFakeApi({
      lists: [INBOX, project],
      tags: [work],
      tasks: [
        fakeTask("Report draft", { list_id: project.id, priority: "high", tags: [work] }),
        fakeTask("Report notes", { list_id: project.id, priority: "high" }),
        fakeTask("Report inbox copy"),
        fakeTask("Report done", {
          list_id: project.id,
          completed: true,
          completed_at: "2026-07-01T10:00:00Z",
        }),
      ],
    });
    render(<App />);

    await searchFor("report");
    expect(
      await screen.findByRole("button", { name: "Open details for Report inbox copy" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "List" }), {
      target: { value: String(project.id) },
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Open details for Report inbox copy" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Open details for Report done" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), {
      target: { value: "open" },
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Open details for Report done" }),
      ).not.toBeInTheDocument(),
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Priority" }), {
      target: { value: "high" },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Open details for Report draft" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Open details for Report notes" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Tag" }), {
      target: { value: String(work.id) },
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Open details for Report notes" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Open details for Report draft" }),
    ).toBeInTheDocument();
  });

  it("opens the task's detail panel from a result", async () => {
    installFakeApi({ tasks: [fakeTask("Buy groceries")] });
    render(<App />);

    await searchFor("groceries");
    fireEvent.click(await screen.findByRole("button", { name: "Open details for Buy groceries" }));

    const panel = await screen.findByRole("complementary", { name: "Task details" });
    expect(within(panel).getByRole("textbox", { name: "Task title" })).toHaveValue("Buy groceries");
  });

  it("fetches nothing for an empty query", async () => {
    const api = installFakeApi({ tasks: [fakeTask("Anything")] });
    render(<App />);

    await searchFor("   ");

    expect(await screen.findByText("Type to search")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open details for Anything" }),
    ).not.toBeInTheDocument();
    expect(searchRequests(api)).toEqual([]);
  });

  it("completes a task from a search result, same as any other row", async () => {
    const api = installFakeApi({ tasks: [fakeTask("Buy groceries")] });
    render(<App />);

    await searchFor("groceries");
    const checkbox = await screen.findByRole("checkbox", { name: "Complete Buy groceries" });
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);

    const patch = await waitFor(() => {
      const request = api.requests.find((r) => r.method === "PATCH");
      expect(request).toBeDefined();
      return request;
    });
    expect(patch?.body).toEqual({ completed: true });
  });

  it("labels each result's List, since results can span every List", async () => {
    const errands = fakeList("Errands");
    installFakeApi({
      lists: [INBOX, errands],
      tasks: [fakeTask("Buy groceries", { list_id: errands.id })],
    });
    render(<App />);

    await searchFor("groceries");
    const row = (
      await screen.findByRole("button", { name: "Open details for Buy groceries" })
    ).closest("li");
    if (row === null) {
      throw new Error("row not found");
    }
    expect(within(row).getByText("Errands")).toBeInTheDocument();
  });

  it("shows the priority indicator on a result with a non-default priority", async () => {
    installFakeApi({
      tasks: [fakeTask("Buy groceries", { priority: "high" })],
    });
    render(<App />);

    await searchFor("groceries");
    const row = (
      await screen.findByRole("button", { name: "Open details for Buy groceries" })
    ).closest("li");
    if (row === null) {
      throw new Error("row not found");
    }
    expect(within(row).getByLabelText("Priority: High")).toBeInTheDocument();
  });

  it("keeps the Inbox chip on a result found out of context", async () => {
    installFakeApi({ lists: [INBOX], tasks: [fakeTask("Buy groceries")] });
    render(<App />);

    await searchFor("groceries");
    const row = (
      await screen.findByRole("button", { name: "Open details for Buy groceries" })
    ).closest("li");
    if (row === null) {
      throw new Error("row not found");
    }
    expect(within(row).getByText("Inbox")).toBeInTheDocument();
  });

  it("shows a distinct hint before a query and a distinct message when a query has no matches", async () => {
    installFakeApi({ tasks: [fakeTask("Buy groceries")] });
    render(<App />);

    await openSearch();
    expect(await screen.findByText(/type to search/i)).toBeInTheDocument();

    await searchFor("no such task");
    await waitFor(() =>
      expect(screen.getByText(/no matches for.*no such task/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/type to search/i)).not.toBeInTheDocument();
  });

  it("highlights Search in the sidebar nav while on /search", async () => {
    installFakeApi();
    render(<App />);

    const nav = await screen.findByRole("navigation", { name: "Views" });
    fireEvent.click(within(nav).getByRole("link", { name: "Search" }));
    await screen.findByRole("heading", { name: "Search" });

    expect(within(nav).getByRole("link", { name: "Search" })).toHaveClass("selected");
  });

  it("keeps the sidebar's own field untouched while Search stays open, but clears it once you navigate away", async () => {
    installFakeApi({ tasks: [fakeTask("Buy groceries")] });
    render(<App />);

    const sidebarBox = await screen.findByRole("searchbox", { name: "Quick search" });
    fireEvent.change(sidebarBox, { target: { value: "groceries" } });
    fireEvent.submit(sidebarBox);
    await screen.findByRole("heading", { name: "Search" });

    // Arriving at Search (even via this field's own submit) doesn't wipe it.
    expect(screen.getByRole("searchbox", { name: "Quick search" })).toHaveValue("groceries");

    const nav = await screen.findByRole("navigation", { name: "Smart Lists" });
    fireEvent.click(within(nav).getByRole("button", { name: "All" }));
    await screen.findByRole("heading", { name: "All" });

    // Search is no longer the active view — the field no longer implies
    // it's filtering "All".
    expect(screen.getByRole("searchbox", { name: "Quick search" })).toHaveValue("");
  });
});
