import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeList, fakeTask, INBOX, installFakeApi } from "./test/fakeApi";

// All tests pin the clock to Friday 2026-07-03, local noon, so overdue and
// date-bucket math is deterministic in any timezone.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

function rowFor(title: string): HTMLElement {
  const row = screen.getByRole("button", { name: `Open details for ${title}` }).closest("li");
  if (row === null) {
    throw new Error(`No row for ${title}`);
  }
  return row;
}

describe("Task dates in list views", () => {
  it("flags overdue tasks, but not future or completed ones", async () => {
    installFakeApi({
      tasks: [
        fakeTask("Late", { due_date: "2026-07-01T00:00:00Z", is_all_day: true }),
        fakeTask("Upcoming", { due_date: "2026-07-10T00:00:00Z", is_all_day: true }),
        fakeTask("Done late", {
          due_date: "2026-07-01T00:00:00Z",
          is_all_day: true,
          completed: true,
        }),
        fakeTask("Timed late", { due_date: new Date(2026, 6, 2, 9, 0).toISOString() }),
      ],
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Inbox" }));
    await screen.findByRole("button", { name: "Open details for Late" });

    expect(rowFor("Late")).toHaveAttribute("data-overdue", "true");
    expect(rowFor("Timed late")).toHaveAttribute("data-overdue", "true");
    expect(rowFor("Upcoming")).not.toHaveAttribute("data-overdue");
    expect(rowFor("Done late")).not.toHaveAttribute("data-overdue");
  });

  it("shows the due date on the task row", async () => {
    installFakeApi({
      tasks: [fakeTask("Upcoming", { due_date: "2026-07-10T00:00:00Z", is_all_day: true })],
    });
    render(<App />);
    await screen.findByRole("button", { name: "Open details for Upcoming" });

    expect(within(rowFor("Upcoming")).getByText("Jul 10")).toBeInTheDocument();
  });

  it("settles a date more than seven days past due: shown, announced overdue, no warning glyph", async () => {
    installFakeApi({
      tasks: [
        fakeTask("Ancient", { due_date: "2026-06-20T00:00:00Z", is_all_day: true }),
        fakeTask("Late", { due_date: "2026-07-01T00:00:00Z", is_all_day: true }),
      ],
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Inbox" }));
    await screen.findByRole("button", { name: "Open details for Ancient" });

    // The date is still shown and still announced as overdue — only the
    // visual alarm (the glyph a recent overdue keeps) goes. The glyph query
    // scopes to the chip's own accessible name, never a class.
    expect(within(rowFor("Ancient")).getByText("Jun 20")).toBeInTheDocument();
    const settledChip = within(rowFor("Ancient")).getByLabelText("Overdue: Jun 20");
    expect(settledChip.querySelector("svg")).toBeNull();

    expect(within(rowFor("Late")).getByText("Jul 1")).toBeInTheDocument();
    const recentChip = within(rowFor("Late")).getByLabelText("Overdue: Jul 1");
    expect(recentChip.querySelector("svg")).not.toBeNull();
  });

  it("settles timed Tasks by local day and never settles completed or undated Tasks", async () => {
    installFakeApi({
      tasks: [
        fakeTask("Timed ancient", { due_date: new Date(2026, 5, 20, 9, 0).toISOString() }),
        fakeTask("Done ancient", {
          due_date: "2026-06-20T00:00:00Z",
          is_all_day: true,
          completed: true,
        }),
        fakeTask("No date", { sort_order: 1 }),
      ],
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Inbox" }));
    await screen.findByRole("button", { name: "Open details for Timed ancient" });

    const timedChip = within(rowFor("Timed ancient")).getByLabelText(/Overdue:/);
    expect(timedChip).toBeInTheDocument();
    expect(timedChip.querySelector("svg")).toBeNull();
    // A completed Task keeps its ordinary rendering, never the settled one:
    // it is not announced as overdue at all.
    expect(within(rowFor("Done ancient")).queryByLabelText(/Overdue:/)).not.toBeInTheDocument();
    expect(rowFor("No date").textContent).not.toMatch(/Jun|Jul/);
  });

  it("flags overdue cards on the kanban board too", async () => {
    const board = fakeList("Board", { view_mode: "kanban" });
    installFakeApi({
      lists: [INBOX, board],
      tasks: [
        fakeTask("Late card", {
          list_id: board.id,
          due_date: "2026-07-01T00:00:00Z",
          is_all_day: true,
        }),
      ],
    });
    render(<App />);

    const nav = await screen.findByRole("navigation", { name: "Lists" });
    // Custom lists load via a separate async fetch, so wait for the Board list
    // button to render before clicking it (a bare getByRole races that fetch).
    fireEvent.click(await within(nav).findByRole("button", { name: "Board" }));
    const card = (
      await screen.findByRole("button", { name: "Open details for Late card" })
    ).closest("li");
    expect(card).toHaveAttribute("data-overdue", "true");
  });

  it("never settles a card on the kanban board (#280 — Kanban is unchanged)", async () => {
    const board = fakeList("Board", { view_mode: "kanban" });
    installFakeApi({
      lists: [INBOX, board],
      tasks: [
        fakeTask("Ancient card", {
          list_id: board.id,
          due_date: "2026-06-20T00:00:00Z",
          is_all_day: true,
        }),
      ],
    });
    render(<App />);

    const nav = await screen.findByRole("navigation", { name: "Lists" });
    fireEvent.click(await within(nav).findByRole("button", { name: "Board" }));
    await screen.findByRole("button", { name: "Open details for Ancient card" });

    // Same Task settles in the List view (see the test above), but the
    // Kanban card keeps the warning glyph regardless of age.
    const chip = screen.getByLabelText("Overdue: Jun 20");
    expect(chip.querySelector("svg")).not.toBeNull();
  });

  it("sorts by date with undated tasks last", async () => {
    installFakeApi({
      tasks: [
        fakeTask("No date", { sort_order: 1 }),
        fakeTask("Later", { due_date: "2026-07-08T00:00:00Z", is_all_day: true, sort_order: 2 }),
        fakeTask("Sooner", { due_date: new Date(2026, 6, 5, 9, 0).toISOString(), sort_order: 3 }),
      ],
    });
    render(<App />);
    await screen.findByRole("button", { name: "Open details for No date" });

    fireEvent.change(screen.getByRole("combobox", { name: "Sort by" }), {
      target: { value: "date" },
    });

    const titles = screen
      .getAllByRole("button", { name: /^Open details for / })
      .map((button) => button.getAttribute("aria-label"));
    expect(titles).toEqual([
      "Open details for Sooner",
      "Open details for Later",
      "Open details for No date",
    ]);
  });

  it("groups by date into Overdue / Today / Tomorrow / Next 7 Days / Later / No date", async () => {
    installFakeApi({
      tasks: [
        fakeTask("Slipped", { due_date: "2026-07-02T00:00:00Z", is_all_day: true }),
        fakeTask("Due today", { due_date: "2026-07-03T00:00:00Z", is_all_day: true }),
        fakeTask("Due tomorrow", { due_date: "2026-07-04T00:00:00Z", is_all_day: true }),
        fakeTask("This week", { due_date: "2026-07-08T00:00:00Z", is_all_day: true }),
        fakeTask("Someday", { due_date: "2026-07-20T00:00:00Z", is_all_day: true }),
        fakeTask("Unplanned"),
      ],
    });
    render(<App />);
    await screen.findByRole("button", { name: "Open details for Slipped" });

    fireEvent.change(screen.getByRole("combobox", { name: "Group by" }), {
      target: { value: "date" },
    });

    const groups: Array<[string, string]> = [
      ["Overdue", "Slipped"],
      ["Today", "Due today"],
      ["Tomorrow", "Due tomorrow"],
      ["Next 7 Days", "This week"],
      ["Later", "Someday"],
      ["No date", "Unplanned"],
    ];
    for (const [label, title] of groups) {
      const group = screen.getByRole("list", { name: `Tasks in ${label}` });
      expect(
        within(group).getByRole("button", { name: `Open details for ${title}` }),
      ).toBeInTheDocument();
    }
  });

  it("groups and sorts a settled (>7-day overdue) task as Overdue, not a bucket of its own (#280)", async () => {
    installFakeApi({
      tasks: [
        fakeTask("Ancient", { due_date: "2026-06-20T00:00:00Z", is_all_day: true, sort_order: 1 }),
        fakeTask("Recent", { due_date: "2026-07-01T00:00:00Z", is_all_day: true, sort_order: 2 }),
      ],
    });
    render(<App />);
    await screen.findByRole("button", { name: "Open details for Ancient" });

    fireEvent.change(screen.getByRole("combobox", { name: "Group by" }), {
      target: { value: "date" },
    });
    const overdueGroup = screen.getByRole("list", { name: "Tasks in Overdue" });
    expect(
      within(overdueGroup).getByRole("button", { name: "Open details for Ancient" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Tasks in Settled" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Group by" }), {
      target: { value: "none" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Sort by" }), {
      target: { value: "date" },
    });
    const titles = screen
      .getAllByRole("button", { name: /^Open details for / })
      .map((button) => button.getAttribute("aria-label"));
    expect(titles).toEqual(["Open details for Ancient", "Open details for Recent"]);
  });
});
