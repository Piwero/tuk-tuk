import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { fakeTask, INBOX, installFakeApi } from "./test/fakeApi";

// Note: fetch stays stubbed across tests (each test installs a fresh fake).

const recurring = (title: string, overrides = {}): ReturnType<typeof fakeTask> =>
  fakeTask(title, {
    due_date: "2026-07-10T15:00:00Z",
    time_zone: "UTC",
    recurrence: "FREQ=DAILY",
    ...overrides,
  });

describe("Completing a recurring task", () => {
  it("keeps the task open with its date advanced and records an occurrence", async () => {
    // Completing goes through the undo toast (#155): the PATCH that
    // actually advances the task and writes the occurrence only fires once
    // the toast is dismissed.
    const run = recurring("Morning run");
    const api = installFakeApi({ tasks: [run] });
    render(<App />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "Complete Morning run" }));
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));

    // The row stays open — the fake advanced the date instead of completing.
    await waitFor(() => {
      const row = api.requests.filter(
        (r) => r.method === "PATCH" && r.url === `/api/v1/tasks/${run.id}`,
      );
      expect(row).toHaveLength(1);
    });
    expect(screen.getByRole("checkbox", { name: "Complete Morning run" })).not.toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Completed" }));

    expect(await screen.findByLabelText("Completed occurrence of Morning run")).toBeInTheDocument();
    expect(
      api.requests.some(
        (r) => r.method === "GET" && r.url === `/api/v1/completed-occurrences?list_id=${INBOX.id}`,
      ),
    ).toBe(true);
  });

  it("undoing a recurring completion never advances the dates or writes an occurrence", async () => {
    const run = recurring("Morning run");
    const api = installFakeApi({ tasks: [run] });
    render(<App />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "Complete Morning run" }));
    // "Completed" also names the completed-view toggle button, so scope the
    // assertion to the toast itself (role="status").
    expect(await screen.findByRole("status")).toHaveTextContent("Completed");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    // Undo is "never send the PATCH" — nothing advanced, nothing recorded.
    expect(api.requests.some((r) => r.method === "PATCH")).toBe(false);
    expect(screen.getByRole("checkbox", { name: "Complete Morning run" })).not.toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Completed" }));
    expect(screen.queryByLabelText(/Completed occurrence of Morning run/)).not.toBeInTheDocument();
  });

  it("a recurrence that has ended completes the row normally", async () => {
    const last = recurring("Last session", { recurrence: "FREQ=DAILY;COUNT=1" });
    installFakeApi({ tasks: [last] });
    render(<App />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "Complete Last session" }));
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));

    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Complete Last session" })).toBeChecked(),
    );
  });
});

describe("The completed view with occurrences", () => {
  it("interleaves Completed Occurrences with completed tasks, newest first", async () => {
    const run = recurring("Morning run");
    installFakeApi({
      tasks: [
        run,
        fakeTask("Old chore", { completed: true, completed_at: "2026-07-01T10:00:00Z" }),
      ],
      completedOccurrences: [
        {
          id: 1,
          task_id: run.id,
          title: "Morning run",
          list_id: INBOX.id,
          completed_at: "2026-07-02T10:00:00Z",
          due_date: "2026-07-02T09:00:00Z",
          is_all_day: false,
        },
      ],
    });
    render(<App />);
    await screen.findByRole("checkbox", { name: "Complete Morning run" });

    fireEvent.click(screen.getByRole("button", { name: "Completed" }));

    const occurrence = await screen.findByLabelText("Completed occurrence of Morning run");
    expect(within(occurrence).queryByRole("checkbox")).not.toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Completed" });
    const rows = within(list)
      .getAllByRole("listitem")
      .map((item) => item.textContent ?? "");
    expect(rows[0]).toContain("Morning run");
    expect(rows[1]).toContain("Old chore");
    // Completed tasks keep their affordances alongside occurrence rows.
    expect(within(list).getByRole("checkbox", { name: "Complete Old chore" })).toBeChecked();
    expect(
      within(list).getByRole("button", { name: "Open details for Old chore" }),
    ).toBeInTheDocument();
  });
});
