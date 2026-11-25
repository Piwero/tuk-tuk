import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeCheckItem, fakeTask, installFakeApi } from "./test/fakeApi";

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
});
