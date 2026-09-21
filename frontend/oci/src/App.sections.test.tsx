import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { closestOrThrow, fakeDataTransfer } from "./test/dnd";
import { fakeList, fakeSection, fakeTask, INBOX, installFakeApi } from "./test/fakeApi";

// Note: fetch stays stubbed across tests (each test installs a fresh fake).
// Restoring the real fetch between tests would let a late in-flight request
// from an unmounting App escape to the network and fail the run.

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

async function openList(name: string): Promise<void> {
  const user = userEvent.setup();
  const nav = await screen.findByRole("navigation", { name: "Lists" });
  // Custom lists load via a separate async fetch; wait for the button first.
  await user.click(await within(nav).findByRole("button", { name }));
}

describe("Sections in the list view", () => {
  it("groups tasks under section headings, ungrouped ones under No section", async () => {
    const project = fakeList("Project");
    const backlog = fakeSection("Backlog", project.id, { sort_order: 1024 });
    const doing = fakeSection("Doing", project.id, { sort_order: 2048 });
    installFakeApi({
      lists: [INBOX, project],
      sections: [backlog, doing],
      tasks: [
        fakeTask("Loose end", { list_id: project.id }),
        fakeTask("Spec it", { list_id: project.id, section_id: backlog.id }),
        fakeTask("Build it", { list_id: project.id, section_id: doing.id }),
      ],
    });
    render(<App />);

    await openList("Project");

    const main = screen.getByRole("main");
    await within(main).findByRole("heading", { name: "Backlog" });
    const headings = within(main).getAllByRole("heading", { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual(["No section", "Backlog", "Doing"]);
    const backlogGroup = screen.getByRole("list", { name: "Tasks in Backlog" });
    expect(within(backlogGroup).getByText("Spec it")).toBeInTheDocument();
    const ungrouped = screen.getByRole("list", { name: "Tasks in No section" });
    expect(within(ungrouped).getByText("Loose end")).toBeInTheDocument();
  });

  it("creates a Section from the Add Section form", async () => {
    const project = fakeList("Project");
    const api = installFakeApi({ lists: [INBOX, project] });
    const user = userEvent.setup();
    render(<App />);
    await openList("Project");

    await user.click(await screen.findByRole("button", { name: "Add Section" }));
    await user.type(screen.getByLabelText("Section name"), "Backlog");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("heading", { name: "Backlog" })).toBeInTheDocument();
    const post = api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/sections");
    expect(post?.body).toEqual({ list_id: project.id, name: "Backlog" });
  });

  it("renames a Section in place", async () => {
    const project = fakeList("Project");
    const backlog = fakeSection("Backlgo", project.id);
    const api = installFakeApi({ lists: [INBOX, project], sections: [backlog] });
    const user = userEvent.setup();
    render(<App />);
    await openList("Project");

    await user.click(await screen.findByRole("button", { name: "Rename section Backlgo" }));
    const input = screen.getByLabelText("Section name");
    expect(input).toHaveValue("Backlgo");
    await user.clear(input);
    await user.type(input, "Backlog");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("heading", { name: "Backlog" })).toBeInTheDocument();
    const patch = api.requests.find(
      (r) => r.method === "PATCH" && r.url === `/api/v1/sections/${backlog.id}`,
    );
    expect(patch?.body).toEqual({ name: "Backlog" });
  });

  it("deleting a Section moves its tasks under No section", async () => {
    const project = fakeList("Project");
    const doing = fakeSection("Doing", project.id);
    const task = fakeTask("Survivor", { list_id: project.id, section_id: doing.id });
    const api = installFakeApi({ lists: [INBOX, project], sections: [doing], tasks: [task] });
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);
    await openList("Project");

    await user.click(await screen.findByRole("button", { name: "Delete section Doing" }));

    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Doing" })).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Survivor")).toBeInTheDocument();
    expect(
      api.requests.some((r) => r.method === "DELETE" && r.url === `/api/v1/sections/${doing.id}`),
    ).toBe(true);
  });
});

describe("Task drag within the list view", () => {
  function taskRow(text: string): HTMLElement {
    return closestOrThrow(screen.getByText(text), "li");
  }

  it("dropping a task on another task moves it before the target, one PATCH", async () => {
    const project = fakeList("Project");
    const backlog = fakeSection("Backlog", project.id, { sort_order: 1024 });
    const doing = fakeSection("Doing", project.id, { sort_order: 2048 });
    const spec = fakeTask("Spec it", {
      list_id: project.id,
      section_id: backlog.id,
      sort_order: 1024,
    });
    const build = fakeTask("Build it", {
      list_id: project.id,
      section_id: doing.id,
      sort_order: 2048,
    });
    const ship = fakeTask("Ship it", {
      list_id: project.id,
      section_id: doing.id,
      sort_order: 3072,
    });
    const api = installFakeApi({
      lists: [INBOX, project],
      sections: [backlog, doing],
      tasks: [spec, build, ship],
    });
    render(<App />);
    await openList("Project");
    await screen.findByText("Ship it");

    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(taskRow("Spec it"), { dataTransfer });
    fireEvent.drop(taskRow("Ship it"), { dataTransfer });

    const doingGroup = screen.getByRole("list", { name: "Tasks in Doing" });
    await waitFor(() => {
      const titles = within(doingGroup)
        .getAllByRole("button", { name: /^Open details/ })
        .map((b) => b.textContent);
      expect(titles).toEqual(["Build it", "Spec it", "Ship it"]);
    });
    const patches = api.requests.filter((r) => r.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0]?.body).toEqual({ section_id: doing.id, sort_order: 2560 });
    expect(
      within(screen.getByRole("list", { name: "Tasks in Backlog" })).queryByText("Spec it"),
    ).not.toBeInTheDocument();
  });

  it("dropping a task on a section heading appends it; No section ungroups it", async () => {
    const project = fakeList("Project");
    const backlog = fakeSection("Backlog", project.id, { sort_order: 1024 });
    const doing = fakeSection("Doing", project.id, { sort_order: 2048 });
    const spec = fakeTask("Spec it", {
      list_id: project.id,
      section_id: backlog.id,
      sort_order: 1024,
    });
    const build = fakeTask("Build it", {
      list_id: project.id,
      section_id: doing.id,
      sort_order: 2048,
    });
    const api = installFakeApi({
      lists: [INBOX, project],
      sections: [backlog, doing],
      tasks: [spec, build],
    });
    render(<App />);
    await openList("Project");
    await screen.findByText("Build it");

    const drag = fakeDataTransfer();
    fireEvent.dragStart(taskRow("Spec it"), { dataTransfer: drag });
    fireEvent.drop(
      closestOrThrow(screen.getByRole("heading", { name: "Doing" }), ".group-header"),
      { dataTransfer: drag },
    );

    const doingGroup = screen.getByRole("list", { name: "Tasks in Doing" });
    expect(await within(doingGroup).findByText("Spec it")).toBeInTheDocument();
    let patch = api.requests.filter((r) => r.method === "PATCH").pop();
    expect(patch?.body).toEqual({ section_id: doing.id, sort_order: 3072 });

    const ungroup = fakeDataTransfer();
    fireEvent.dragStart(taskRow("Build it"), { dataTransfer: ungroup });
    fireEvent.drop(
      closestOrThrow(screen.getByRole("heading", { name: "No section" }), ".group-header"),
      { dataTransfer: ungroup },
    );

    const noneGroup = screen.getByRole("list", { name: "Tasks in No section" });
    expect(await within(noneGroup).findByText("Build it")).toBeInTheDocument();
    patch = api.requests.filter((r) => r.method === "PATCH").pop();
    expect(patch?.body).toEqual({ section_id: null, sort_order: 1024 });
  });

  it("Custom sort explains itself: 'not yet arranged' until a drag happens, then 'your order' (issue #260)", async () => {
    const project = fakeList("Project");
    const backlog = fakeSection("Backlog", project.id, { sort_order: 1024 });
    const spec = fakeTask("Spec it", {
      list_id: project.id,
      section_id: backlog.id,
      sort_order: 1024,
    });
    const build = fakeTask("Build it", {
      list_id: project.id,
      section_id: backlog.id,
      sort_order: 2048,
    });
    installFakeApi({ lists: [INBOX, project], sections: [backlog], tasks: [spec, build] });
    render(<App />);
    await openList("Project");
    await screen.findByText("Build it");

    const sortSelect = screen.getByRole("combobox", { name: "Sort by" });
    expect(within(sortSelect).getByRole("option", { name: /not yet arranged/ })).toBeDefined();
    expect(screen.getByText("Drag a Task to start your own order.")).toBeInTheDocument();
    expect(sortSelect).toHaveAccessibleDescription("Drag a Task to start your own order.");

    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(taskRow("Spec it"), { dataTransfer });
    fireEvent.drop(taskRow("Build it"), { dataTransfer });

    await waitFor(() => {
      expect(screen.getByText("Drag a Task to reorder it.")).toBeInTheDocument();
    });
    expect(
      within(screen.getByRole("combobox", { name: "Sort by" })).getByRole("option", {
        name: /your order/,
      }),
    ).toBeDefined();
  });

  it("reorders Sections by dragging one heading onto another", async () => {
    const project = fakeList("Project");
    const backlog = fakeSection("Backlog", project.id, { sort_order: 1024 });
    const doing = fakeSection("Doing", project.id, { sort_order: 2048 });
    const api = installFakeApi({ lists: [INBOX, project], sections: [backlog, doing] });
    render(<App />);
    await openList("Project");
    await screen.findByRole("heading", { name: "Doing" });

    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(
      closestOrThrow(screen.getByRole("heading", { name: "Doing" }), ".group-header"),
      { dataTransfer },
    );
    fireEvent.drop(
      closestOrThrow(screen.getByRole("heading", { name: "Backlog" }), ".group-header"),
      { dataTransfer },
    );

    const main = screen.getByRole("main");
    await waitFor(() => {
      const headings = within(main)
        .getAllByRole("heading", { level: 2 })
        .map((h) => h.textContent);
      expect(headings).toEqual(["No section", "Doing", "Backlog"]);
    });
    const patch = api.requests.find(
      (r) => r.method === "PATCH" && r.url === `/api/v1/sections/${doing.id}`,
    );
    expect(patch?.body).toEqual({ sort_order: 0 });
  });

  it("dropping a section on empty space below moves it to the end", async () => {
    const project = fakeList("Project");
    const backlog = fakeSection("Backlog", project.id, { sort_order: 1024 });
    const doing = fakeSection("Doing", project.id, { sort_order: 2048 });
    const api = installFakeApi({ lists: [INBOX, project], sections: [backlog, doing] });
    render(<App />);
    await openList("Project");
    await screen.findByRole("heading", { name: "Doing" });

    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(
      closestOrThrow(screen.getByRole("heading", { name: "Backlog" }), ".group-header"),
      { dataTransfer },
    );
    fireEvent.drop(
      closestOrThrow(screen.getByRole("main"), "main").querySelector(".task-groups")!,
      {
        dataTransfer,
      },
    );

    const main = screen.getByRole("main");
    await waitFor(() => {
      const headings = within(main)
        .getAllByRole("heading", { level: 2 })
        .map((h) => h.textContent);
      expect(headings).toEqual(["No section", "Doing", "Backlog"]);
    });
    const patch = api.requests.find(
      (r) => r.method === "PATCH" && r.url === `/api/v1/sections/${backlog.id}`,
    );
    expect(patch?.body).toEqual({ sort_order: 3072 });
  });

  it("dropping a task on empty space in a sectionless list moves it to the end", async () => {
    const project = fakeList("Project");
    const first = fakeTask("First", { list_id: project.id, sort_order: 1024 });
    const second = fakeTask("Second", { list_id: project.id, sort_order: 2048 });
    const api = installFakeApi({ lists: [INBOX, project], tasks: [first, second] });
    render(<App />);
    await openList("Project");
    await screen.findByText("Second");

    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(taskRow("First"), { dataTransfer });
    fireEvent.drop(screen.getByRole("main").querySelector(".task-groups")!, { dataTransfer });

    const flat = screen.getByRole("list", { name: "Tasks" });
    await waitFor(() => {
      const titles = within(flat)
        .getAllByRole("button", { name: /^Open details/ })
        .map((b) => b.textContent);
      expect(titles).toEqual(["Second", "First"]);
    });
    const patch = api.requests.find(
      (r) => r.method === "PATCH" && r.url === `/api/v1/tasks/${first.id}`,
    );
    expect(patch?.body).toEqual({ section_id: null, sort_order: 3072 });
  });
});

describe("Group and sort controls", () => {
  it("groups by priority and sorts by title within groups", async () => {
    const project = fakeList("Project");
    installFakeApi({
      lists: [INBOX, project],
      tasks: [
        fakeTask("Zebra chore", { list_id: project.id, priority: "high", sort_order: 1024 }),
        fakeTask("Apple chore", { list_id: project.id, priority: "high", sort_order: 2048 }),
        fakeTask("Idle thought", { list_id: project.id, sort_order: 3072 }),
      ],
    });
    const user = userEvent.setup();
    render(<App />);
    await openList("Project");
    await screen.findByText("Idle thought");

    await user.selectOptions(screen.getByRole("combobox", { name: "Group by" }), "Priority");
    await user.selectOptions(screen.getByRole("combobox", { name: "Sort by" }), "Title");

    const main = screen.getByRole("main");
    const headings = within(main)
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(headings).toEqual(["High", "No priority"]);
    const highGroup = screen.getByRole("list", { name: "Tasks in High" });
    const titles = within(highGroup)
      .getAllByRole("button", { name: /^Open details/ })
      .map((b) => b.textContent);
    expect(titles).toEqual(["Apple chore", "Zebra chore"]);
  });
});
