import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeList, fakeTask, installFakeApi, INBOX } from "./test/fakeApi";

afterEach(() => {
  vi.restoreAllMocks();
});

async function openActions(listName: string, taskTitle: string): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("button", { name: listName }));
  fireEvent.click(await screen.findByRole("button", { name: `Actions for ${taskTitle}` }));
  return screen.findByRole("dialog", { name: `Actions for ${taskTitle}` });
}

describe("acting on a Task from the command palette", () => {
  it("moves the Task through an in-surface List picker, by keyboard alone", async () => {
    const task = fakeTask("Call the plumber", { list_id: 10 });
    const api = installFakeApi({
      lists: [fakeList("Errands", { id: 10 }), fakeList("Reading", { id: 11 })],
      tasks: [task],
    });
    render(<App />);
    const dialog = await openActions("Errands", "Call the plumber");

    // complete(0) focus(1) reschedule(2) move(3)
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "Enter" });

    // The picker opened inside the same dialog — no separate dialog.
    expect(within(dialog).getByRole("option", { name: "Reading" })).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);

    fireEvent.keyDown(dialog, { key: "Enter" });

    await waitFor(() => {
      const patch = api.requests.find(
        (r) => r.method === "PATCH" && r.url === `/api/v1/tasks/${task.id}`,
      );
      expect(patch?.body).toMatchObject({ list_id: 11 });
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("deletes through the same undo path a row delete uses", async () => {
    const api = installFakeApi({ tasks: [fakeTask("Old chore")] });
    render(<App />);
    const dialog = await openActions("Inbox", "Old chore");

    fireEvent.click(within(dialog).getByRole("option", { name: "Delete" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Task deleted");
    expect(screen.queryByText("Old chore")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(api.requests.some((r) => r.method === "DELETE")).toBe(false);
    expect(await screen.findByText("Old chore")).toBeInTheDocument();
  });

  it("advances a recurring Task in place and records a Completed Occurrence", async () => {
    const task = fakeTask("Morning run", {
      due_date: "2026-07-10T15:00:00Z",
      time_zone: "UTC",
      recurrence: "FREQ=DAILY",
    });
    const api = installFakeApi({ tasks: [task] });
    render(<App />);
    const dialog = await openActions("Inbox", "Morning run");

    // The verb reads as an occurrence, not a close.
    fireEvent.click(within(dialog).getByRole("option", { name: "Complete this occurrence" }));
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));

    await waitFor(() => {
      const patches = api.requests.filter(
        (r) => r.method === "PATCH" && r.url === `/api/v1/tasks/${task.id}`,
      );
      expect(patches).toHaveLength(1);
    });
    // Still open — the row was advanced, not completed.
    expect(screen.getByRole("checkbox", { name: "Complete Morning run" })).not.toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Completed" }));
    expect(await screen.findByLabelText("Completed occurrence of Morning run")).toBeInTheDocument();
    expect(
      api.requests.some(
        (r) => r.method === "GET" && r.url === `/api/v1/completed-occurrences?list_id=${INBOX.id}`,
      ),
    ).toBe(true);
  });

  it("undoing a recurring completion never sends the PATCH", async () => {
    const task = fakeTask("Morning run", {
      due_date: "2026-07-10T15:00:00Z",
      time_zone: "UTC",
      recurrence: "FREQ=DAILY",
    });
    const api = installFakeApi({ tasks: [task] });
    render(<App />);
    const dialog = await openActions("Inbox", "Morning run");

    fireEvent.click(within(dialog).getByRole("option", { name: "Complete this occurrence" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Completed");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(api.requests.some((r) => r.method === "PATCH")).toBe(false);
    expect(screen.getByRole("checkbox", { name: "Complete Morning run" })).not.toBeChecked();
  });

  it("steps back from a picker to the verb list on Escape", async () => {
    installFakeApi({
      tags: [{ id: 5, name: "urgent", color: null }],
      tasks: [fakeTask("Call the plumber")],
    });
    render(<App />);
    const dialog = await openActions("Inbox", "Call the plumber");

    fireEvent.click(within(dialog).getByRole("option", { name: "Add a Tag" }));
    expect(within(dialog).getByRole("option", { name: "#urgent" })).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(within(dialog).getByRole("option", { name: "Add a Tag" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("option", { name: "#urgent" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
