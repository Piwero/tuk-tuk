import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeFolder, fakeList, fakeTag, fakeTask, INBOX, installFakeApi } from "./test/fakeApi";

/** Loading, empty and error states on Task views (#441): placeholder rows
 * while a view loads, a real empty state once it has loaded with nothing,
 * and Retry when the load fails — never an empty view for an unloaded one. */

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

function taskReads(api: ReturnType<typeof installFakeApi>): string[] {
  return api.requests
    .filter((r) => r.method === "GET" && r.url.startsWith("/api/v1/tasks?"))
    .map((r) => r.url);
}

describe("Task view loading state", () => {
  it("shows busy placeholder rows, not an empty state, until Today has loaded", async () => {
    let release = (): void => {};
    const api = installFakeApi({
      tasks: [fakeTask("Due today", { due_date: "2026-07-03T00:00:00Z", is_all_day: true })],
    });
    api.taskReadGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    window.history.replaceState(null, "", "/today");
    render(<App />);

    const busy = await screen.findByRole("status", { name: "Loading tasks" });
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(busy.querySelectorAll(".skeleton-row").length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: /nothing due today/i })).not.toBeInTheDocument();

    release();
    expect(
      await screen.findByRole("button", { name: "Open details for Due today" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading tasks" })).not.toBeInTheDocument();
  });
});

describe("Task view empty state", () => {
  it("says what an empty Today is for and offers New task", async () => {
    installFakeApi();
    window.history.replaceState(null, "", "/today");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Nothing due today" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New task" }));
    expect(await screen.findByRole("dialog", { name: "Quick add" })).toBeInTheDocument();
  });

  it("gives an empty List its own empty state", async () => {
    const groceries = fakeList("Groceries");
    installFakeApi({ lists: [INBOX, groceries] });
    render(<App />);

    const nav = await screen.findByRole("navigation", { name: "Lists" });
    fireEvent.click(await within(nav).findByRole("link", { name: "Groceries" }));
    expect(await screen.findByRole("heading", { name: "Groceries is empty" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New task" })).toBeInTheDocument();
  });

  it("gives an empty Tag its own empty state", async () => {
    const work = fakeTag("work");
    installFakeApi({ tags: [work] });
    render(<App />);

    const nav = await screen.findByRole("navigation", { name: "Tags" });
    fireEvent.click(await within(nav).findByRole("link", { name: "work" }));
    expect(
      await screen.findByRole("heading", { name: "No tasks tagged work" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New task" })).toBeInTheDocument();
  });

  it("gives a Folder whose Lists hold no Tasks an empty state", async () => {
    const home = fakeFolder("Home");
    const chores = fakeList("Chores", { folder_id: home.id });
    installFakeApi({ lists: [INBOX, chores], folders: [home] });
    render(<App />);

    const nav = await screen.findByRole("navigation", { name: "Lists" });
    fireEvent.click(await within(nav).findByRole("link", { name: "Home" }));
    expect(await screen.findByRole("heading", { name: "Nothing in Home" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New task" })).toBeInTheDocument();
  });

  it("offers Clear search when a search matches nothing", async () => {
    const api = installFakeApi({ tasks: [fakeTask("Buy milk")] });
    window.history.replaceState(null, "", "/search");
    render(<App />);

    const field = await screen.findByRole("searchbox", { name: "Search tasks" });
    fireEvent.change(field, { target: { value: "zebra" } });
    expect(
      await screen.findByRole("heading", { name: "No matches for “zebra”" }),
    ).toBeInTheDocument();
    expect(taskReads(api).some((url) => url.includes("search=zebra"))).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    await waitFor(() => expect(field).toHaveValue(""));
  });
});

describe("Task view error state", () => {
  it("says what failed and refetches on Retry", async () => {
    const api = installFakeApi({
      tasks: [fakeTask("Due today", { due_date: "2026-07-03T00:00:00Z", is_all_day: true })],
    });
    api.failTaskRead = (params) => params.get("view") === "today";
    window.history.replaceState(null, "", "/today");
    render(<App />);

    const alert = (await screen.findByText("Couldn’t load Today")).closest('[role="alert"]');
    if (!(alert instanceof HTMLElement)) throw new Error("no alert");
    expect(screen.queryByRole("heading", { name: "Nothing due today" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open details/ })).not.toBeInTheDocument();
    const todayReads = (): number =>
      taskReads(api).filter((url) => url === "/api/v1/tasks?view=today&today=2026-07-03").length;
    // Let the load settle (React 19 can leave a refetch effect pending) so the
    // count below measures only what Retry sends.
    await act(async () => {});
    const before = todayReads();
    expect(before).toBeGreaterThan(0);

    api.failTaskRead = null;
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(
      await screen.findByRole("button", { name: "Open details for Due today" }),
    ).toBeInTheDocument();
    expect(todayReads()).toBe(before + 1);
    expect(screen.queryByText("Couldn’t load Today")).not.toBeInTheDocument();
  });
});
