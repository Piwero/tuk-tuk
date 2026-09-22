import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeList, fakeTask, fakeTimer, installFakeApi, INBOX } from "./test/fakeApi";

beforeEach(() => {
  localStorage.clear();
});

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

    // complete(0) focus(1) pomo(2) reschedule(3) move(4)
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
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

  it("opens scoped to the selected Task on cmd/ctrl+K", async () => {
    installFakeApi({ tasks: [fakeTask("Call the plumber")] });
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open details for Call the plumber" }),
    );
    await screen.findByRole("complementary", { name: "Task details" });

    fireEvent.keyDown(document, { key: "k", metaKey: true });

    const dialog = await screen.findByRole("dialog", { name: "Actions for Call the plumber" });
    expect(within(dialog).getByRole("option", { name: "Delete" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
  });

  it("starts a saved Pomo from Actions, one click deeper, by keyboard alone", async () => {
    const task = fakeTask("Write report");
    installFakeApi({
      tasks: [task],
      timers: [
        fakeTimer("Deep Work 50", { duration_seconds: 3000 }),
        fakeTimer("Quick 15", { duration_seconds: 900 }),
      ],
    });
    render(<App />);
    const dialog = await openActions("Inbox", "Write report");

    fireEvent.click(within(dialog).getByRole("option", { name: "Start Pomo" }));

    expect(await within(dialog).findByRole("option", { name: "Deep Work 50" })).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: "Quick 15" })).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: "Custom…" })).toBeInTheDocument();

    // Picker order: Deep Work 50 (0), Quick 15 (1), Custom… (2).
    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "Enter" });

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Focus timer running, 15:00 left" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Focus timer running, 15:00 left" }));
    // A running stage states its link as text, not as an inert select.
    expect(await within(screen.getByRole("main")).findByText(/Focusing on/)).toHaveTextContent(
      task.title,
    );
  });

  it("offers the 25-minute default plus Custom… when no Pomo Timer is saved", async () => {
    installFakeApi({ tasks: [fakeTask("Write report")] });
    render(<App />);
    const dialog = await openActions("Inbox", "Write report");

    fireEvent.click(within(dialog).getByRole("option", { name: "Start Pomo" }));

    expect(within(dialog).getByRole("option", { name: "Focus: 25min" })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("option", { name: "Focus: 25min" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Focus timer running, 25:00 left" }),
      ).toBeInTheDocument(),
    );
  });

  it("Custom… lands on the Focus view, where a one-off length is adjustable", async () => {
    const task = fakeTask("Write report");
    installFakeApi({ tasks: [task] });
    render(<App />);
    const dialog = await openActions("Inbox", "Write report");

    fireEvent.click(within(dialog).getByRole("option", { name: "Start Pomo" }));
    fireEvent.click(within(dialog).getByRole("option", { name: "Custom…" }));

    expect(await screen.findByRole("heading", { name: "Focus" })).toBeInTheDocument();
    // A running stage states its link as text, not as an inert select.
    expect(await within(screen.getByRole("main")).findByText(/Focusing on/)).toHaveTextContent(
      task.title,
    );
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
