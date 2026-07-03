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
    fireEvent.click(within(nav).getByRole("button", { name: "Board" }));
    const card = (
      await screen.findByRole("button", { name: "Open details for Late card" })
    ).closest("li");
    expect(card).toHaveAttribute("data-overdue", "true");
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
});
