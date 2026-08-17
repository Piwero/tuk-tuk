import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { closestOrThrow, fakeDataTransfer } from "./test/dnd";
import { fakeList, fakeSection, fakeTag, fakeTask, INBOX, installFakeApi } from "./test/fakeApi";

// Note: fetch stays stubbed across tests (each test installs a fresh fake).
// Restoring the real fetch between tests would let a late in-flight request
// from an unmounting App escape to the network and fail the run.

afterEach(() => {
  vi.restoreAllMocks();
});

async function openList(name: string): Promise<void> {
  const user = userEvent.setup();
  const nav = await screen.findByRole("navigation", { name: "Lists" });
  // Custom lists load via a separate async fetch; wait for the button first.
  await user.click(await within(nav).findByRole("button", { name }));
}

describe("Kanban view", () => {
  it("renders the List's Sections as columns in Section order", async () => {
    const board = fakeList("Board", { view_mode: "kanban" });
    const backlog = fakeSection("Backlog", board.id, { sort_order: 2048 });
    const doing = fakeSection("Doing", board.id, { sort_order: 1024 });
    installFakeApi({
      lists: [INBOX, board],
      sections: [backlog, doing],
      tasks: [
        fakeTask("Spec it", { list_id: board.id, section_id: backlog.id }),
        fakeTask("Build it", { list_id: board.id, section_id: doing.id }),
      ],
    });
    render(<App />);

    await openList("Board");

    const kanban = await screen.findByRole("region", { name: "Kanban board" });
    const columns = within(kanban).getAllByRole("list");
    expect(columns.map((c) => c.getAttribute("aria-label"))).toEqual([
      "Cards in Doing",
      "Cards in Backlog",
    ]);
    expect(
      within(within(kanban).getByRole("list", { name: "Cards in Backlog" })).getByText("Spec it"),
    ).toBeInTheDocument();
    expect(
      within(within(kanban).getByRole("list", { name: "Cards in Doing" })).getByText("Build it"),
    ).toBeInTheDocument();
  });

  it("switching a List to kanban persists the view mode and swaps the view", async () => {
    const board = fakeList("Board");
    const api = installFakeApi({ lists: [INBOX, board] });
    const user = userEvent.setup();
    render(<App />);
    await openList("Board");

    await user.click(await screen.findByRole("button", { name: "Switch to kanban view" }));

    expect(await screen.findByRole("region", { name: "Kanban board" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch to list view" })).toBeInTheDocument();
    const patch = api.requests.find(
      (r) => r.method === "PATCH" && r.url === `/api/v1/lists/${board.id}`,
    );
    expect(patch?.body).toEqual({ view_mode: "kanban" });
    expect(api.lists.find((l) => l.id === board.id)?.view_mode).toBe("kanban");

    await user.click(screen.getByRole("button", { name: "Switch to list view" }));

    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Kanban board" })).not.toBeInTheDocument(),
    );
  });

  it("dragging a card to another column moves the task into that Section", async () => {
    const board = fakeList("Board", { view_mode: "kanban" });
    const backlog = fakeSection("Backlog", board.id, { sort_order: 1024 });
    const doing = fakeSection("Doing", board.id, { sort_order: 2048 });
    const spec = fakeTask("Spec it", {
      list_id: board.id,
      section_id: backlog.id,
      sort_order: 1024,
    });
    const build = fakeTask("Build it", {
      list_id: board.id,
      section_id: doing.id,
      sort_order: 2048,
    });
    const api = installFakeApi({
      lists: [INBOX, board],
      sections: [backlog, doing],
      tasks: [spec, build],
    });
    render(<App />);
    await openList("Board");
    const kanban = await screen.findByRole("region", { name: "Kanban board" });

    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(closestOrThrow(within(kanban).getByText("Spec it"), "li"), {
      dataTransfer,
    });
    fireEvent.drop(within(kanban).getByRole("list", { name: "Cards in Doing" }), {
      dataTransfer,
    });

    const doingColumn = within(kanban).getByRole("list", { name: "Cards in Doing" });
    expect(await within(doingColumn).findByText("Spec it")).toBeInTheDocument();
    const patch = api.requests.find(
      (r) => r.method === "PATCH" && r.url === `/api/v1/tasks/${spec.id}`,
    );
    expect(patch?.body).toEqual({ section_id: doing.id, sort_order: 3072 });
    expect(api.tasks.find((t) => t.id === spec.id)?.section_id).toBe(doing.id);

    const before = fakeDataTransfer();
    fireEvent.dragStart(closestOrThrow(within(doingColumn).getByText("Spec it"), "li"), {
      dataTransfer: before,
    });
    fireEvent.drop(closestOrThrow(within(doingColumn).getByText("Build it"), "li"), {
      dataTransfer: before,
    });

    await waitFor(() => {
      const titles = within(within(kanban).getByRole("list", { name: "Cards in Doing" }))
        .getAllByRole("button", { name: /^Open details/ })
        .map((b) => b.textContent);
      expect(titles).toEqual(["Spec it", "Build it"]);
    });
  });

  it("adding a task within a column creates it in that Section", async () => {
    const board = fakeList("Board", { view_mode: "kanban" });
    const backlog = fakeSection("Backlog", board.id);
    const api = installFakeApi({ lists: [INBOX, board], sections: [backlog] });
    const user = userEvent.setup();
    render(<App />);
    await openList("Board");
    const kanban = await screen.findByRole("region", { name: "Kanban board" });

    const input = within(kanban).getByRole("textbox", { name: "Add a task to Backlog" });
    await user.type(input, "Sketch the API{Enter}");

    const column = within(kanban).getByRole("list", { name: "Cards in Backlog" });
    expect(await within(column).findByText("Sketch the API")).toBeInTheDocument();
    expect(input).toHaveValue("");
    const post = api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/tasks");
    expect(post?.body).toEqual({
      title: "Sketch the API",
      list_id: board.id,
      section_id: backlog.id,
    });
  });

  it("shows a No section column only when ungrouped tasks exist", async () => {
    const board = fakeList("Board", { view_mode: "kanban" });
    const backlog = fakeSection("Backlog", board.id);
    installFakeApi({
      lists: [INBOX, board],
      sections: [backlog],
      tasks: [fakeTask("Loose end", { list_id: board.id })],
    });
    render(<App />);
    await openList("Board");
    const kanban = await screen.findByRole("region", { name: "Kanban board" });

    expect(within(kanban).getByRole("list", { name: "Cards in No section" })).toBeInTheDocument();

    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(closestOrThrow(within(kanban).getByText("Loose end"), "li"), {
      dataTransfer,
    });
    fireEvent.drop(within(kanban).getByRole("list", { name: "Cards in Backlog" }), {
      dataTransfer,
    });

    await waitFor(() =>
      expect(
        within(kanban).queryByRole("list", { name: "Cards in No section" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      within(kanban)
        .getAllByRole("list")
        .map((c) => c.getAttribute("aria-label")),
    ).toEqual(["Cards in Backlog"]);
  });

  it("offers Add Section on an empty board so the first column can be created", async () => {
    const board = fakeList("Board", { view_mode: "kanban" });
    const api = installFakeApi({ lists: [INBOX, board] });
    const user = userEvent.setup();
    render(<App />);
    await openList("Board");
    const kanban = await screen.findByRole("region", { name: "Kanban board" });

    await user.click(within(kanban).getByRole("button", { name: "Add Section" }));
    await user.type(screen.getByLabelText("Section name"), "Backlog");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await within(kanban).findByRole("list", { name: "Cards in Backlog" }),
    ).toBeInTheDocument();
    const post = api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/sections");
    expect(post?.body).toEqual({ list_id: board.id, name: "Backlog" });
  });
});

describe("Kanban cards: metadata (#165)", () => {
  it("shows a checkbox, tag chips and priority indicator — the same metadata TaskRow renders in the List view", async () => {
    const board = fakeList("Board", { view_mode: "kanban" });
    const backlog = fakeSection("Backlog", board.id);
    const tag = fakeTag("urgent", { color: "#e5484d" });
    const task = fakeTask("Ship it", {
      list_id: board.id,
      section_id: backlog.id,
      priority: "high",
      tags: [tag],
    });
    installFakeApi({ lists: [INBOX, board], sections: [backlog], tasks: [task] });
    render(<App />);
    await openList("Board");
    const kanban = await screen.findByRole("region", { name: "Kanban board" });

    const checkbox = within(kanban).getByRole("checkbox", { name: "Complete Ship it" });
    expect(checkbox).not.toBeChecked();
    expect(within(kanban).getByText("urgent")).toBeInTheDocument();
    const card = checkbox.closest("li");
    expect(card).not.toBeNull();
    expect(card).toHaveAttribute("data-priority", "high");
  });

  it("a task completed elsewhere starts checked on its card, and unticking un-completes it", async () => {
    const board = fakeList("Board", { view_mode: "kanban" });
    const done = fakeSection("Done", board.id);
    const task = fakeTask("Ship it", {
      list_id: board.id,
      section_id: done.id,
      completed: true,
      completed_at: "2026-07-01T00:00:00Z",
    });
    const api = installFakeApi({ lists: [INBOX, board], sections: [done], tasks: [task] });
    render(<App />);
    await openList("Board");
    const kanban = await screen.findByRole("region", { name: "Kanban board" });

    const checkbox = within(kanban).getByRole("checkbox", { name: "Complete Ship it" });
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);

    await waitFor(() => expect(checkbox).not.toBeChecked());
    const patch = api.requests.find(
      (r) => r.method === "PATCH" && r.url === `/api/v1/tasks/${task.id}`,
    );
    expect(patch?.body).toEqual({ completed: false });
  });
});

describe("Kanban cards: completing honours undo (#155) and recurrence (ADR 0003)", () => {
  // Undoing relies on real time passing (the toast's window), so these
  // tests pin the clock rather than leaving it real — same convention as
  // App.taskUndo.test.tsx and App.recurrence.test.tsx.
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function tick(ms: number): void {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  async function openBoard(name: string): Promise<void> {
    // Plain fireEvent rather than the file's userEvent-based openList: with
    // fake timers active, userEvent's internal delays need to be told to
    // advance them, which isn't worth wiring up for one click.
    const nav = await screen.findByRole("navigation", { name: "Lists" });
    fireEvent.click(await within(nav).findByRole("button", { name }));
    await screen.findByRole("region", { name: "Kanban board" });
  }

  it("shows Completed — Undo, and undo leaves the card unchecked with nothing sent", async () => {
    const board = fakeList("Board", { view_mode: "kanban" });
    const backlog = fakeSection("Backlog", board.id);
    const task = fakeTask("Ship it", { list_id: board.id, section_id: backlog.id });
    const api = installFakeApi({ lists: [INBOX, board], sections: [backlog], tasks: [task] });
    render(<App />);
    await openBoard("Board");

    fireEvent.click(screen.getByRole("checkbox", { name: "Complete Ship it" }));

    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent("Completed");
    expect(within(toast).getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(api.requests.some((r) => r.method === "PATCH")).toBe(false);

    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Complete Ship it" })).not.toBeChecked();
    tick(10_000);
    expect(api.requests.some((r) => r.method === "PATCH")).toBe(false);
  });

  it("committing after the toast window sends exactly one PATCH", async () => {
    const board = fakeList("Board", { view_mode: "kanban" });
    const backlog = fakeSection("Backlog", board.id);
    const task = fakeTask("Ship it", { list_id: board.id, section_id: backlog.id });
    const api = installFakeApi({ lists: [INBOX, board], sections: [backlog], tasks: [task] });
    render(<App />);
    await openBoard("Board");

    fireEvent.click(screen.getByRole("checkbox", { name: "Complete Ship it" }));
    tick(5_000);

    await waitFor(() => {
      const patches = api.requests.filter((r) => r.method === "PATCH");
      expect(patches).toHaveLength(1);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("a recurring task's card completion advances the date in place instead of completing it", async () => {
    const board = fakeList("Board", { view_mode: "kanban" });
    const backlog = fakeSection("Backlog", board.id);
    const run = fakeTask("Morning run", {
      list_id: board.id,
      section_id: backlog.id,
      due_date: "2026-07-10T15:00:00Z",
      time_zone: "UTC",
      recurrence: "FREQ=DAILY",
    });
    const api = installFakeApi({ lists: [INBOX, board], sections: [backlog], tasks: [run] });
    render(<App />);
    await openBoard("Board");

    fireEvent.click(screen.getByRole("checkbox", { name: "Complete Morning run" }));
    tick(5_000);

    await waitFor(() => {
      const patches = api.requests.filter(
        (r) => r.method === "PATCH" && r.url === `/api/v1/tasks/${run.id}`,
      );
      expect(patches).toHaveLength(1);
    });
    // The recurring task stays open on the board — the fake server advanced
    // the date instead of completing it (ADR 0003), same as the List view.
    expect(screen.getByRole("checkbox", { name: "Complete Morning run" })).not.toBeChecked();
  });
});
