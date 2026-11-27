import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { closestOrThrow, fakeDataTransfer } from "./test/dnd";
import { fakeCheckItem, fakeTask, installFakeApi } from "./test/fakeApi";
import { UNDO_WINDOW_MS } from "./undoQueue";

/* Now (issue #547): one Task the User chose to do next, inside Today. */

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 3, 12));
});
afterEach(() => vi.useRealTimers());

const LONG_TITLE =
  "Write the quarterly report for the board, including every appendix the auditors asked for";

function openToday(): void {
  window.history.replaceState(null, "", "/today");
  render(<App />);
}

const nowPanel = () => screen.findByRole("region", { name: "Now" });

async function choose(title: string, opener: string): Promise<void> {
  fireEvent.click(within(await nowPanel()).getByRole("button", { name: opener }));
  const dialog = await screen.findByRole("dialog", { name: "Choose a Task for Now" });
  fireEvent.click(within(dialog).getByRole("button", { name: title }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

describe("Now in Today", () => {
  it("is absent while the feature is off, leaving Today as it was", async () => {
    const task = fakeTask("Due today", { due_date: "2026-07-03T00:00:00Z", is_all_day: true });
    installFakeApi({ tasks: [task], nowTaskId: task.id });
    openToday();
    await screen.findByRole("heading", { name: "Today" });
    await screen.findByText("Due today");
    expect(screen.queryByRole("region", { name: "Now" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose a Task" })).not.toBeInTheDocument();
  });

  it("starts empty with one sentence and Choose a Task", async () => {
    installFakeApi({ nowEnabled: true });
    openToday();
    const panel = await nowPanel();
    expect(within(panel).getByText("Pick the one Task to do next.")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Choose a Task" })).toBeInTheDocument();
  });

  it("selects an unscheduled Task with its full title, without changing the Task", async () => {
    const task = fakeTask(LONG_TITLE, { priority: "high" });
    const api = installFakeApi({ nowEnabled: true, tasks: [task] });
    openToday();

    await choose(LONG_TITLE, "Choose a Task");

    const panel = await nowPanel();
    expect(await within(panel).findByText(LONG_TITLE)).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Choose another" })).toBeInTheDocument();
    const writes = api.requests.filter((r) => r.method !== "GET");
    expect(writes.map((r) => [r.method, r.url, r.body])).toEqual([
      ["PUT", "/api/v1/now", { task_id: task.id }],
    ]);
  });

  it("announces the confirmed Now Task once, in the panel's live region", async () => {
    installFakeApi({ nowEnabled: true, tasks: [fakeTask("Pack the bag")] });
    openToday();
    const panel = await nowPanel();
    expect(within(panel).getByRole("status")).toHaveTextContent("");

    await choose("Pack the bag", "Choose a Task");

    await waitFor(() =>
      expect(within(panel).getByRole("status")).toHaveTextContent("Now: Pack the bag"),
    );
  });

  it("returns focus to the opener when the picker is dismissed", async () => {
    installFakeApi({ nowEnabled: true, tasks: [fakeTask("Anything")] });
    openToday();
    const opener = within(await nowPanel()).getByRole("button", { name: "Choose a Task" });
    opener.focus();
    fireEvent.click(opener);
    await screen.findByRole("dialog", { name: "Choose a Task for Now" });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it("offers only open Tasks in the picker", async () => {
    installFakeApi({
      nowEnabled: true,
      tasks: [fakeTask("Open one"), fakeTask("Done one", { completed: true })],
    });
    openToday();
    fireEvent.click(within(await nowPanel()).getByRole("button", { name: "Choose a Task" }));
    const dialog = await screen.findByRole("dialog", { name: "Choose a Task for Now" });
    expect(within(dialog).getByRole("button", { name: "Open one" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Done one" })).not.toBeInTheDocument();
  });

  it("replaces and removes the selection", async () => {
    const first = fakeTask("First");
    const second = fakeTask("Second");
    const api = installFakeApi({ nowEnabled: true, tasks: [first, second], nowTaskId: first.id });
    openToday();
    expect(await within(await nowPanel()).findByText("First")).toBeInTheDocument();

    await choose("Second", "Choose another");
    expect(await within(await nowPanel()).findByText("Second")).toBeInTheDocument();

    fireEvent.click(within(await nowPanel()).getByRole("button", { name: "Remove from Now" }));
    expect(await within(await nowPanel()).findByRole("button", { name: "Choose a Task" }));
    expect(
      api.requests.filter((r) => r.url === "/api/v1/now" && r.method === "PUT").map((r) => r.body),
    ).toEqual([{ task_id: second.id }, { task_id: null }]);
  });

  it("restores the selection after a reload", async () => {
    const task = fakeTask("Keep me");
    installFakeApi({ nowEnabled: true, tasks: [task] });
    openToday();
    await choose("Keep me", "Choose a Task");
    cleanup();

    openToday();
    expect(await within(await nowPanel()).findByText("Keep me")).toBeInTheDocument();
  });

  it("clears to Choose a Task when the Now Task is completed from Today", async () => {
    const task = fakeTask("Due today", { due_date: "2026-07-03T00:00:00Z", is_all_day: true });
    installFakeApi({ nowEnabled: true, tasks: [task], nowTaskId: task.id });
    openToday();
    expect(await within(await nowPanel()).findByText("Due today")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Complete Due today" }));
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);

    const panel = await nowPanel();
    expect(await within(panel).findByRole("button", { name: "Choose a Task" })).toBeInTheDocument();
    expect(within(panel).getByText("Pick the one Task to do next.")).toBeInTheDocument();
  });

  it("clears a recurring Now Task once today's occurrence is completed", async () => {
    const task = fakeTask("Morning run", {
      due_date: "2026-07-03T00:00:00Z",
      is_all_day: true,
      recurrence: "FREQ=DAILY",
    });
    installFakeApi({ nowEnabled: true, tasks: [task], nowTaskId: task.id });
    openToday();
    expect(await within(await nowPanel()).findByText("Morning run")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Complete Morning run" }));
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);

    const panel = await nowPanel();
    expect(await within(panel).findByRole("button", { name: "Choose a Task" })).toBeInTheDocument();
    expect(within(panel).queryByText("Morning run")).not.toBeInTheDocument();
  });

  it("is turned on from Settings", async () => {
    const api = installFakeApi({});
    window.history.replaceState(null, "", "/settings");
    render(<App />);
    const toggle = await screen.findByRole("checkbox", { name: /Now/ });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
    expect(api.requests.some((r) => r.method === "PUT" && r.url === "/api/v1/settings/now")).toBe(
      true,
    );
  });
});

describe("Now's next Check Item", () => {
  it("shows the first incomplete Check Item under the Task title", async () => {
    const task = fakeTask("Pack bags", {
      check_items: [
        fakeCheckItem("Socks", { done: true, sort_order: 1024 }),
        fakeCheckItem("Charger", { sort_order: 2048 }),
        fakeCheckItem("Passport", { sort_order: 3072 }),
      ],
    });
    installFakeApi({ nowEnabled: true, tasks: [task], nowTaskId: task.id });
    openToday();
    const panel = await nowPanel();
    expect(await within(panel).findByText("Pack bags")).toBeInTheDocument();
    expect(within(panel).getByRole("checkbox", { name: "Tick Charger" })).not.toBeChecked();
    expect(within(panel).queryByText("Socks")).not.toBeInTheDocument();
    expect(within(panel).queryByText("Passport")).not.toBeInTheDocument();
  });

  it("advances to the next Check Item when the visible one is ticked, without completing the Task", async () => {
    const socks = fakeCheckItem("Socks", { sort_order: 1024 });
    const charger = fakeCheckItem("Charger", { sort_order: 2048 });
    const task = fakeTask("Pack bags", { check_items: [socks, charger] });
    const api = installFakeApi({ nowEnabled: true, tasks: [task], nowTaskId: task.id });
    openToday();
    const panel = await nowPanel();
    fireEvent.click(await within(panel).findByRole("checkbox", { name: "Tick Socks" }));

    expect(
      await within(panel).findByRole("checkbox", { name: "Tick Charger" }),
    ).toBeInTheDocument();
    expect(within(panel).getByRole("status")).toHaveTextContent("Next: Charger");
    expect(
      api.requests.filter((r) => r.method !== "GET").map((r) => [r.method, r.url, r.body]),
    ).toEqual([
      [
        "PATCH",
        `/api/v1/tasks/${task.id}/check-items/${socks.id}?auto_complete=false`,
        { done: true },
      ],
    ]);
    expect(api.tasks.find((t) => t.id === task.id)?.completed).toBe(false);
  });

  it("shows the Task title alone when it has no Check Items", async () => {
    const task = fakeTask("Call the bank");
    installFakeApi({ nowEnabled: true, tasks: [task], nowTaskId: task.id });
    openToday();
    const panel = await nowPanel();
    expect(await within(panel).findByText("Call the bank")).toBeInTheDocument();
    expect(within(panel).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(panel).queryByText(/Check Items done/)).not.toBeInTheDocument();
  });

  it("offers a deliberate completion once every Check Item is done", async () => {
    const last = fakeCheckItem("Passport");
    const task = fakeTask("Pack bags", { check_items: [last] });
    const api = installFakeApi({ nowEnabled: true, tasks: [task], nowTaskId: task.id });
    openToday();
    const panel = await nowPanel();
    fireEvent.click(await within(panel).findByRole("checkbox", { name: "Tick Passport" }));

    expect(await within(panel).findByText("All Check Items done.")).toBeInTheDocument();
    expect(within(panel).getByRole("status")).toHaveTextContent("All Check Items done");
    expect(within(panel).getByText("Pack bags")).toBeInTheDocument();
    expect(api.tasks.find((t) => t.id === task.id)?.completed).toBe(false);

    fireEvent.click(within(panel).getByRole("button", { name: "Complete Pack bags" }));
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    await waitFor(() => expect(api.tasks.find((t) => t.id === task.id)?.completed).toBe(true));
  });

  it("follows a reorder made in Task detail", async () => {
    const socks = fakeCheckItem("Socks", { sort_order: 1024 });
    const passport = fakeCheckItem("Passport", { sort_order: 2048 });
    const task = fakeTask("Pack bags", {
      due_date: "2026-07-03T00:00:00Z",
      is_all_day: true,
      check_items: [socks, passport],
    });
    installFakeApi({ nowEnabled: true, tasks: [task], nowTaskId: task.id });
    openToday();
    const panel = await nowPanel();
    expect(await within(panel).findByRole("checkbox", { name: "Tick Socks" })).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Open details for Pack bags" }));
    const detail = await screen.findByRole("complementary", { name: "Task details" });
    const items = within(detail).getByRole("list", { name: "Check items" });
    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(closestOrThrow(within(items).getByText("Passport"), "li"), {
      dataTransfer,
    });
    fireEvent.drop(closestOrThrow(within(items).getByText("Socks"), "li"), { dataTransfer });

    expect(
      await within(panel).findByRole("checkbox", { name: "Tick Passport" }),
    ).toBeInTheDocument();
  });
});

describe("Work without timer", () => {
  const stage = () => screen.findByRole("dialog", { name: "Work without timer" });

  async function startTimerFree(): Promise<HTMLElement> {
    const panel = await nowPanel();
    fireEvent.click(await within(panel).findByRole("button", { name: "Work without timer" }));
    return stage();
  }

  it("shows the Now Task and its next Check Item with no clock, and creates no Focus Session", async () => {
    const task = fakeTask("Pack bags", {
      check_items: [fakeCheckItem("Socks", { done: true }), fakeCheckItem("Charger")],
    });
    const api = installFakeApi({ nowEnabled: true, tasks: [task], nowTaskId: task.id });
    openToday();
    const mode = await startTimerFree();

    expect(within(mode).getByText("Pack bags")).toBeInTheDocument();
    expect(within(mode).getByRole("checkbox", { name: "Tick Charger" })).toBeInTheDocument();
    expect(within(mode).queryByText(/\d+:\d\d/)).not.toBeInTheDocument();
    expect(within(mode).queryByText(/\bmin(ute)?s?\b/i)).not.toBeInTheDocument();
    expect(within(mode).queryByRole("timer")).not.toBeInTheDocument();
    expect(within(mode).queryByRole("progressbar")).not.toBeInTheDocument();

    fireEvent.click(within(mode).getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.requests.filter((r) => r.url.startsWith("/api/v1/focus-sessions"))).toEqual([]);
    expect(api.requests.filter((r) => r.method !== "GET")).toEqual([]);
  });

  it("ticks Check Items as the Now panel does, then completes the Task", async () => {
    const socks = fakeCheckItem("Socks");
    const task = fakeTask("Pack bags", { check_items: [socks] });
    const api = installFakeApi({ nowEnabled: true, tasks: [task], nowTaskId: task.id });
    openToday();
    const mode = await startTimerFree();

    fireEvent.click(within(mode).getByRole("checkbox", { name: "Tick Socks" }));
    expect(await within(mode).findByText("All Check Items done.")).toBeInTheDocument();
    expect(
      api.requests.filter((r) => r.method !== "GET").map((r) => [r.method, r.url, r.body]),
    ).toEqual([
      [
        "PATCH",
        `/api/v1/tasks/${task.id}/check-items/${socks.id}?auto_complete=false`,
        { done: true },
      ],
    ]);
    expect(api.tasks.find((t) => t.id === task.id)?.completed).toBe(false);

    fireEvent.click(within(mode).getByRole("button", { name: "Complete Pack bags" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    await waitFor(() => expect(api.tasks.find((t) => t.id === task.id)?.completed).toBe(true));
    expect(api.requests.filter((r) => r.url.startsWith("/api/v1/focus-sessions"))).toEqual([]);
  });
});
