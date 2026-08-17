import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeList, fakeTag, fakeTask, INBOX, installFakeApi } from "./test/fakeApi";

// Pinned so "today" (used by the date sort/group and by fetchSmartTasks) is
// deterministic in any timezone, matching App.smart.test.tsx's convention.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

async function openAll(): Promise<void> {
  const nav = await screen.findByRole("navigation", { name: "Smart Lists" });
  fireEvent.click(await within(nav).findByRole("button", { name: "All" }));
  await screen.findByRole("heading", { name: "All" });
}

function taskNames(): string[] {
  return screen
    .getAllByRole("button", { name: /^Open details for / })
    .map((button) => button.getAttribute("aria-label")?.replace("Open details for ", ""));
}

describe("All view: filter and sort controls", () => {
  it("offers List, Tag, Priority, Group by and Sort by controls only in All", async () => {
    installFakeApi();
    render(<App />);

    // Inbox (a plain List view) has Group by / Sort by but no List/Tag/Priority filters.
    await screen.findByRole("combobox", { name: "Add a task" });
    expect(screen.getByRole("combobox", { name: "Group by" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Sort by" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "List" })).not.toBeInTheDocument();

    await openAll();
    expect(screen.getByRole("combobox", { name: "List" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Tag" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Priority" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Group by" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Sort by" })).toBeInTheDocument();
  });

  it("Today and Next 7 Days show none of the filter or group/sort controls", async () => {
    installFakeApi();
    render(<App />);

    const nav = await screen.findByRole("navigation", { name: "Smart Lists" });
    fireEvent.click(await within(nav).findByRole("button", { name: "Today" }));
    await screen.findByRole("heading", { name: "Today" });

    expect(screen.queryByRole("combobox", { name: "List" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Group by" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Sort by" })).not.toBeInTheDocument();
  });

  it("filtering by List narrows to that List's tasks and sends list_id with view=all", async () => {
    const errands = fakeList("Errands");
    const api = installFakeApi({
      lists: [INBOX, errands],
      tasks: [fakeTask("Inbox task"), fakeTask("Errand", { list_id: errands.id })],
    });
    render(<App />);

    await openAll();
    expect(
      await screen.findByRole("button", { name: "Open details for Inbox task" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open details for Errand" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "List" }), {
      target: { value: String(errands.id) },
    });

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Open details for Inbox task" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Open details for Errand" })).toBeInTheDocument();
    expect(
      api.requests.some(
        (r) =>
          r.method === "GET" &&
          r.url === `/api/v1/tasks?view=all&today=2026-07-03&list_id=${errands.id}`,
      ),
    ).toBe(true);
  });

  it("filtering by Tag and Priority narrows, combined", async () => {
    const work = fakeTag("work");
    installFakeApi({
      tags: [work],
      tasks: [
        fakeTask("Tagged high", { priority: "high", tags: [work] }),
        fakeTask("Tagged low", { priority: "low", tags: [work] }),
        fakeTask("Untagged high", { priority: "high" }),
      ],
    });
    render(<App />);

    await openAll();
    fireEvent.change(screen.getByRole("combobox", { name: "Tag" }), {
      target: { value: String(work.id) },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Priority" }), {
      target: { value: "high" },
    });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Open details for Tagged high" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "Open details for Tagged low" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open details for Untagged high" }),
    ).not.toBeInTheDocument();
  });

  it("sorting by Priority orders tasks High to None", async () => {
    installFakeApi({
      tasks: [
        fakeTask("Low one", { priority: "low" }),
        fakeTask("High one", { priority: "high" }),
        fakeTask("No priority", { priority: "none" }),
        fakeTask("Medium one", { priority: "medium" }),
      ],
    });
    render(<App />);

    await openAll();
    await screen.findByRole("button", { name: "Open details for Low one" });
    fireEvent.change(screen.getByRole("combobox", { name: "Sort by" }), {
      target: { value: "priority" },
    });

    await waitFor(() =>
      expect(taskNames()).toEqual(["High one", "Medium one", "Low one", "No priority"]),
    );
  });

  it("grouping by Priority shows a heading per level", async () => {
    installFakeApi({
      tasks: [fakeTask("High one", { priority: "high" }), fakeTask("Low one", { priority: "low" })],
    });
    render(<App />);

    await openAll();
    await screen.findByRole("button", { name: "Open details for High one" });
    fireEvent.change(screen.getByRole("combobox", { name: "Group by" }), {
      target: { value: "priority" },
    });

    expect(await screen.findByRole("heading", { name: "High" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Low" })).toBeInTheDocument();
  });

  it("grouping by List shows a heading per List, in sidebar order", async () => {
    const errands = fakeList("Errands");
    installFakeApi({
      lists: [INBOX, errands],
      tasks: [fakeTask("Errand", { list_id: errands.id }), fakeTask("Inbox task")],
    });
    render(<App />);

    await openAll();
    await screen.findByRole("button", { name: "Open details for Inbox task" });
    fireEvent.change(screen.getByRole("combobox", { name: "Group by" }), {
      target: { value: "list" },
    });

    const main = screen.getByRole("main");
    const headings = await within(main).findAllByRole("heading", { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual([INBOX.name, errands.name]);
    const inboxGroup = screen.getByRole("list", { name: `Tasks in ${INBOX.name}` });
    expect(
      within(inboxGroup).getByRole("button", { name: "Open details for Inbox task" }),
    ).toBeInTheDocument();
    const errandsGroup = screen.getByRole("list", { name: `Tasks in ${errands.name}` });
    expect(
      within(errandsGroup).getByRole("button", { name: "Open details for Errand" }),
    ).toBeInTheDocument();
  });
});
