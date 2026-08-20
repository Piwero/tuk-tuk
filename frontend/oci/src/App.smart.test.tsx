import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeList, fakeTask, INBOX, installFakeApi } from "./test/fakeApi";

// All tests pin the clock to Friday 2026-07-03, local noon, so "today" is
// deterministic in any timezone.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

async function openSmart(name: string): Promise<void> {
  const nav = await screen.findByRole("navigation", { name: "Smart Lists" });
  // Smart lists load via a separate async fetch; wait for the button first.
  fireEvent.click(await within(nav).findByRole("button", { name }));
}

describe("Smart Lists", () => {
  it("shows Today, Next 7 Days, All in the sidebar above the Lists", async () => {
    installFakeApi();
    render(<App />);

    const smart = await screen.findByRole("navigation", { name: "Smart Lists" });
    expect(
      within(smart)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Today", "Next 7 Days", "All"]);

    const lists = await screen.findByRole("navigation", { name: "Lists" });
    expect(smart.compareDocumentPosition(lists)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("Today queries the computed view with the local day and hides Quick-Add", async () => {
    const api = installFakeApi({
      tasks: [
        fakeTask("Due today", { due_date: "2026-07-03T00:00:00Z", is_all_day: true }),
        fakeTask("Overdue", { due_date: "2026-07-01T00:00:00Z", is_all_day: true }),
        fakeTask("Future", { due_date: "2026-07-20T00:00:00Z", is_all_day: true }),
      ],
    });
    render(<App />);

    await openSmart("Today");

    expect(await screen.findByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Open details for Due today" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open details for Overdue" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open details for Future" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Add a task" })).not.toBeInTheDocument();
    expect(
      api.requests.some(
        (r) => r.method === "GET" && r.url === "/api/v1/tasks?view=today&today=2026-07-03",
      ),
    ).toBe(true);
  });

  it("completing a task in Today makes it leave the computed view once the undo toast commits", async () => {
    installFakeApi({
      tasks: [fakeTask("Due today", { due_date: "2026-07-03T00:00:00Z", is_all_day: true })],
    });
    render(<App />);

    await openSmart("Today");
    fireEvent.click(await screen.findByRole("checkbox", { name: "Complete Due today" }));

    // Still visible while the completion is only pending (#155) — membership
    // in a computed view is the server's call, made once the toast commits.
    expect(screen.getByRole("button", { name: "Open details for Due today" })).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Open details for Due today" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("Next 7 Days shows the coming week only", async () => {
    const api = installFakeApi({
      tasks: [
        fakeTask("Due today", { due_date: "2026-07-03T00:00:00Z", is_all_day: true }),
        fakeTask("Day seven", { due_date: "2026-07-09T00:00:00Z", is_all_day: true }),
        fakeTask("Day eight", { due_date: "2026-07-10T00:00:00Z", is_all_day: true }),
        fakeTask("Overdue", { due_date: "2026-07-01T00:00:00Z", is_all_day: true }),
      ],
    });
    render(<App />);

    await openSmart("Next 7 Days");

    expect(await screen.findByRole("heading", { name: "Next 7 Days" })).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Open details for Due today" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open details for Day seven" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open details for Day eight" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open details for Overdue" }),
    ).not.toBeInTheDocument();
    expect(
      api.requests.some(
        (r) => r.method === "GET" && r.url === "/api/v1/tasks?view=next7&today=2026-07-03",
      ),
    ).toBe(true);
  });

  it("All shows open tasks across Lists and none of the completed ones", async () => {
    const errands = fakeList("Errands");
    installFakeApi({
      lists: [INBOX, errands],
      tasks: [
        fakeTask("Inbox task"),
        fakeTask("Errand", { list_id: errands.id }),
        fakeTask("Done", { completed: true, completed_at: "2026-07-02T10:00:00Z" }),
      ],
    });
    render(<App />);

    await openSmart("All");

    expect(await screen.findByRole("heading", { name: "All" })).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Open details for Inbox task" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open details for Errand" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open details for Done" })).not.toBeInTheDocument();
  });
});

describe("Completed view", () => {
  it("lists a List's completed tasks newest first and toggles back to open", async () => {
    const api = installFakeApi({
      tasks: [
        fakeTask("Open task"),
        fakeTask("Done early", { completed: true, completed_at: "2026-07-01T10:00:00Z" }),
        fakeTask("Done late", { completed: true, completed_at: "2026-07-02T10:00:00Z" }),
      ],
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Inbox" }));
    await screen.findByRole("button", { name: "Open details for Open task" });

    fireEvent.click(screen.getByRole("button", { name: "Completed" }));

    await waitFor(() => {
      const rows = screen
        .getAllByRole("button", { name: /^Open details for / })
        .map((button) => button.getAttribute("aria-label"));
      expect(rows).toEqual(["Open details for Done late", "Open details for Done early"]);
    });
    expect(
      api.requests.some(
        (r) => r.method === "GET" && r.url === `/api/v1/tasks?completed=true&list_id=${INBOX.id}`,
      ),
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Open tasks" }));
    expect(
      await screen.findByRole("button", { name: "Open details for Open task" }),
    ).toBeInTheDocument();
  });

  it("reopening a task removes it from the completed view", async () => {
    installFakeApi({
      tasks: [fakeTask("Done", { completed: true, completed_at: "2026-07-02T10:00:00Z" })],
    });
    render(<App />);

    // The Completed toggle only renders once the lists load and the default
    // Inbox view is selected — await it rather than racing that fetch.
    fireEvent.click(await screen.findByRole("button", { name: "Completed" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Complete Done" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Open details for Done" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("the All view has a completed view across Lists", async () => {
    const api = installFakeApi({
      tasks: [fakeTask("Done", { completed: true, completed_at: "2026-07-02T10:00:00Z" })],
    });
    render(<App />);

    await openSmart("All");
    fireEvent.click(await screen.findByRole("button", { name: "Completed" }));

    expect(
      await screen.findByRole("button", { name: "Open details for Done" }),
    ).toBeInTheDocument();
    expect(
      api.requests.some((r) => r.method === "GET" && r.url === "/api/v1/tasks?completed=true"),
    ).toBe(true);
  });

  it("Today has no completed view toggle", async () => {
    installFakeApi();
    render(<App />);

    await openSmart("Today");

    await screen.findByRole("heading", { name: "Today" });
    expect(screen.queryByRole("button", { name: "Completed" })).not.toBeInTheDocument();
  });
});
