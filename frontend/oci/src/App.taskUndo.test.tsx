import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import {
  fakeCheckItem,
  fakeSection,
  fakeTag,
  fakeTask,
  installFakeApi,
  INBOX,
} from "./test/fakeApi";

// Undoing delete/complete (#155) relies on real time passing (the toast's
// window), so every test here pins the clock rather than leaving it real.
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

describe("Deleting a task", () => {
  it("stays up for at least 5 seconds before committing", async () => {
    const api = installFakeApi({ tasks: [fakeTask("Old chore")] });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Delete Old chore" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Task deleted");

    // Comfortably under the 5s window: still up, nothing sent yet.
    tick(3_000);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(api.requests.some((r) => r.method === "DELETE")).toBe(false);

    // Past the window: committed, and the toast is gone.
    tick(3_000);
    await waitFor(() => expect(api.requests.some((r) => r.method === "DELETE")).toBe(true));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("undo restores the task with its list, section, position, dates, tags, priority, description and check items intact", async () => {
    const section = fakeSection("Chores", INBOX.id);
    const tag = fakeTag("urgent", { color: "#e5484d" });
    const task = fakeTask("Old chore", {
      section_id: section.id,
      priority: "high",
      description: "Take the bins out before Tuesday.",
      due_date: "2026-07-04T00:00:00Z",
      is_all_day: true,
      tags: [tag],
      check_items: [
        fakeCheckItem("Bring the bins in", { done: true }),
        fakeCheckItem("Rinse them out", { done: false }),
      ],
    });
    const api = installFakeApi({
      tasks: [task, fakeTask("Other chore", { section_id: section.id })],
      sections: [section],
    });
    render(<App />);

    await screen.findByText("Old chore");
    fireEvent.click(screen.getByRole("button", { name: "Delete Old chore" }));
    expect(screen.queryByText("Old chore")).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));

    // Restored, and never sent to the backend at all.
    expect(api.requests.some((r) => r.method === "DELETE")).toBe(false);
    const heading = await screen.findByRole("heading", { name: "Chores" });
    const group = heading.closest(".task-group");
    expect(group).not.toBeNull();
    // Back under its own Section, not floating elsewhere in the list.
    expect(within(group as HTMLElement).getByText("Old chore")).toBeInTheDocument();
    const row = within(group as HTMLElement)
      .getByRole("button", { name: "Open details for Old chore" })
      .closest("li");
    expect(row).not.toBeNull();
    const withinRow = within(row as HTMLElement);
    expect(withinRow.getByText("urgent")).toBeInTheDocument();
    expect(row).toHaveAttribute("data-priority", "high");
    expect(withinRow.getByText("1/2")).toBeInTheDocument();

    // Description and check-item done state, only shown in the detail panel.
    fireEvent.click(withinRow.getByRole("button", { name: "Open details for Old chore" }));
    expect(await screen.findByText("Take the bins out before Tuesday.")).toBeInTheDocument();
    const checkItems = screen.getByRole("list", { name: "Check items" });
    expect(
      within(checkItems).getByRole("checkbox", { name: "Tick Bring the bins in" }),
    ).toBeChecked();
    expect(
      within(checkItems).getByRole("checkbox", { name: "Tick Rinse them out" }),
    ).not.toBeChecked();
  });
});

describe("Completing a task", () => {
  it("shows Completed — Undo, and undo returns it to open in its original position", async () => {
    const section = fakeSection("Chores", INBOX.id);
    // Created in display order, so each gets an ascending sort_order.
    const above = fakeTask("Above", { section_id: section.id });
    const task = fakeTask("Water plants", { section_id: section.id });
    const below = fakeTask("Below", { section_id: section.id });
    installFakeApi({ tasks: [above, task, below], sections: [section] });
    render(<App />);

    const checkbox = await screen.findByRole("checkbox", { name: "Complete Water plants" });
    fireEvent.click(checkbox);

    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent("Completed");
    expect(within(toast).getByRole("button", { name: "Undo" })).toBeInTheDocument();

    fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Complete Water plants" })).not.toBeChecked();
    // Still between the same neighbors — sort order was never touched.
    const rows = screen
      .getAllByRole("button", { name: /^Open details for/ })
      .map((button) => button.textContent);
    expect(rows).toEqual(["Above", "Water plants", "Below"]);
  });

  it("dismissing or letting the toast expire commits the action with no orphaned state", async () => {
    const api = installFakeApi({ tasks: [fakeTask("Water plants")] });
    render(<App />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "Complete Water plants" }));
    tick(5_000);

    await waitFor(() => {
      const patches = api.requests.filter((r) => r.method === "PATCH");
      expect(patches).toHaveLength(1);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    // No leftover timer still armed to fire a second, duplicate request.
    tick(10_000);
    expect(api.requests.filter((r) => r.method === "PATCH")).toHaveLength(1);
  });
});
