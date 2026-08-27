import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { closestOrThrow, fakeDataTransfer } from "./test/dnd";
import { fakeList, fakeTask, INBOX, installFakeApi } from "./test/fakeApi";

/** The open-Task count shown on a sidebar item, or 0 when nothing is shown
 * (a zero count renders no element at all — issue #195). */
function sidebarCount(name: string): number {
  const button = screen.getByRole("button", { name });
  const badge =
    button.querySelector(".nav-count") ??
    closestOrThrow(button, ".list-row, .folder-row").querySelector(".folder-count");
  return badge === null ? 0 : Number(badge.textContent);
}

describe("Sidebar open-Task counts (issue #195)", () => {
  it("counts open Tasks per Smart List, Inbox and List, and shows nothing for zero", async () => {
    const errands = fakeList("Errands");
    installFakeApi({
      lists: [INBOX, errands, fakeList("Empty")],
      tasks: [
        fakeTask("Milk"),
        fakeTask("Bread"),
        fakeTask("Post office", { list_id: errands.id }),
        fakeTask("Filed away", { list_id: errands.id, completed: true }),
      ],
    });
    render(<App />);
    await screen.findByRole("button", { name: "Inbox" });

    expect(sidebarCount("Inbox")).toBe(2);
    expect(sidebarCount("Errands")).toBe(1); // the completed one does not count
    expect(sidebarCount("Empty")).toBe(0);
    expect(sidebarCount("All")).toBe(3);
    // Zero shows nothing, not "0".
    expect(within(screen.getByRole("button", { name: "Empty" })).queryByText("0")).toBeNull();
  });

  it("folds the count into the item's accessible description", async () => {
    installFakeApi({ tasks: [fakeTask("Milk"), fakeTask("Bread")] });
    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Inbox" })).toHaveAccessibleDescription(
        "2 open tasks",
      ),
    );
    expect(screen.getByRole("button", { name: "All" })).toHaveAccessibleDescription("2 open tasks");
  });

  it("drops the count when a Task is completed", async () => {
    installFakeApi({ tasks: [fakeTask("Water plants"), fakeTask("Buy milk")] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Inbox" }));
    expect(sidebarCount("Inbox")).toBe(2);

    await user.click(await screen.findByRole("checkbox", { name: "Complete Water plants" }));
    await user.click(await screen.findByRole("button", { name: "Dismiss" }));

    await waitFor(() => expect(sidebarCount("Inbox")).toBe(1));
    expect(sidebarCount("All")).toBe(1);
  });

  it("raises the count when a Task is created", async () => {
    installFakeApi({ tasks: [fakeTask("Water plants")] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Inbox" }));
    expect(sidebarCount("Inbox")).toBe(1);

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "Buy milk{Enter}");

    await waitFor(() => expect(sidebarCount("Inbox")).toBe(2));
    expect(sidebarCount("All")).toBe(2);
  });

  it("moves the count with a Task dragged to another List", async () => {
    const errands = fakeList("Errands");
    installFakeApi({ lists: [INBOX, errands], tasks: [fakeTask("Buy milk")] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Inbox" }));
    await screen.findByText("Buy milk");
    expect(sidebarCount("Inbox")).toBe(1);
    expect(sidebarCount("Errands")).toBe(0);

    const dataTransfer = fakeDataTransfer();
    const taskRow = closestOrThrow(screen.getByText("Buy milk"), "li");
    fireEvent.dragStart(taskRow, { dataTransfer });
    fireEvent.drop(closestOrThrow(screen.getByRole("button", { name: "Errands" }), ".list-row"), {
      dataTransfer,
    });

    await waitFor(() => expect(sidebarCount("Errands")).toBe(1));
    expect(sidebarCount("Inbox")).toBe(0);
  });

  it("drops the count when a Task is deleted", async () => {
    installFakeApi({ tasks: [fakeTask("Old chore"), fakeTask("Keep me")] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Inbox" }));
    expect(sidebarCount("Inbox")).toBe(2);

    await user.click(await screen.findByRole("button", { name: "Delete Old chore" }));
    await user.click(await screen.findByRole("button", { name: "Dismiss" }));

    await waitFor(() => expect(sidebarCount("Inbox")).toBe(1));
    expect(sidebarCount("All")).toBe(1);
  });
});
