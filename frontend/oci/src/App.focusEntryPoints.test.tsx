import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import {
  fakeFolder,
  fakeList,
  fakeTask,
  fakeTimer,
  INBOX,
  installFakeApi,
  type FakeTask,
} from "./test/fakeApi";

// Every Focus entry point says what it does (#539): a control that only
// navigates reads "Open Focus" and leaves the clock idle; a control that
// starts reads "Start…" and begins exactly one Focus Session.

// Friday 2026-07-03, local noon (TZ=UTC suite-wide).
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0));
  // A running Focus session persists itself; tests must not inherit one.
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

type Api = ReturnType<typeof installFakeApi>;

function tick(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function main(): ReturnType<typeof within> {
  return within(screen.getByRole("main"));
}

/** Focus is open with `title` linked, idle, and nothing was recorded. */
async function expectFocusOpenedIdle(api: Api, title: string): Promise<void> {
  expect(await screen.findByRole("heading", { name: "Focus" })).toBeInTheDocument();
  expect(await main().findByRole("button", { name: `Linked: ${title}` })).toBeInTheDocument();
  expect(main().getByRole("button", { name: "Start" })).toBeInTheDocument();
  expect(main().queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Focus timer running/ })).not.toBeInTheDocument();
  expect(
    api.requests.filter((r) => r.method !== "GET" && r.url.startsWith("/api/v1/focus-sessions")),
  ).toEqual([]);
}

/** One Pomo of `minutes` is running; letting it run out records exactly one
 * Focus Session with `link`, and no second run follows it. */
async function expectOneSessionStarted(
  api: Api,
  minutes: number,
  link: { task_id: number | null; habit_id?: number | null },
): Promise<void> {
  const mm = String(minutes).padStart(2, "0");
  const before = String(minutes - 1).padStart(2, "0");
  expect(
    await screen.findByRole("button", {
      name: new RegExp(`^Focus timer running, (${mm}:00|${before}:\\d\\d) left$`),
    }),
  ).toBeInTheDocument();
  expect(api.focusSessions).toHaveLength(0);

  tick(minutes * 60_000);
  await waitFor(() => expect(api.focusSessions).toHaveLength(1));
  expect(api.focusSessions[0]).toMatchObject({ mode: "pomo", ...link });

  tick(minutes * 60_000);
  expect(api.focusSessions).toHaveLength(1);
  expect(screen.queryByRole("button", { name: /Focus timer running/ })).not.toBeInTheDocument();
}

async function openActions(title: string): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("button", { name: `Actions for ${title}` }));
  return screen.findByRole("dialog", { name: `Actions for ${title}` });
}

async function openQuickStartMenu(title: string): Promise<HTMLElement> {
  const row = await screen.findByRole("button", { name: `Open details for ${title}` });
  fireEvent.contextMenu(row.closest("li") as HTMLElement);
  return screen.findByRole("menu", { name: `Start Focus for ${title}` });
}

describe("Focus entry points that only open Focus", () => {
  it("the Task row's Open Focus opens Focus with the Task linked, clock idle", async () => {
    const api = installFakeApi({ tasks: [fakeTask("Write report")] });
    render(<App />);

    const button = await screen.findByRole("button", { name: "Open Focus for Write report" });
    expect(button).toHaveTextContent("Open Focus");
    fireEvent.click(button);

    await expectFocusOpenedIdle(api, "Write report");
  });

  it("the Task detail's Open Focus opens Focus with the Task linked, clock idle", async () => {
    const api = installFakeApi({ tasks: [fakeTask("Write report")] });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Open details for Write report" }));
    const panel = await screen.findByRole("complementary", { name: "Task details" });
    fireEvent.click(within(panel).getByRole("button", { name: "Open Focus" }));

    await expectFocusOpenedIdle(api, "Write report");
  });

  it("the Folder view row's Open Focus opens Focus with the Task linked, clock idle", async () => {
    const work = fakeFolder("Work");
    const backend = fakeList("Backend", { folder_id: work.id });
    const api = installFakeApi({
      folders: [work],
      lists: [INBOX, backend],
      tasks: [fakeTask("Ship API", { list_id: backend.id })],
    });
    render(<App />);
    const sidebar = screen.getByRole("complementary");
    fireEvent.click(await within(sidebar).findByRole("link", { name: "Work" }));
    await screen.findByRole("heading", { name: "Work", level: 1 });

    const button = await screen.findByRole("button", { name: "Open Focus for Ship API" });
    expect(button).toHaveTextContent("Open Focus");
    fireEvent.click(button);

    await expectFocusOpenedIdle(api, "Ship API");
  });

  it("the Actions palette's Open Focus verb opens Focus with the Task linked, clock idle", async () => {
    const api = installFakeApi({ tasks: [fakeTask("Write report")] });
    render(<App />);

    const dialog = await openActions("Write report");
    fireEvent.click(within(dialog).getByRole("option", { name: "Open Focus" }));

    await expectFocusOpenedIdle(api, "Write report");
  });

  it("the Start Pomo picker's custom-length row says it opens Focus, and leaves the clock idle", async () => {
    const api = installFakeApi({ tasks: [fakeTask("Write report")] });
    render(<App />);

    const dialog = await openActions("Write report");
    fireEvent.click(within(dialog).getByRole("option", { name: "Start Pomo" }));
    expect(within(dialog).queryByRole("option", { name: "Custom…" })).not.toBeInTheDocument();
    fireEvent.click(
      await within(dialog).findByRole("option", { name: "Open Focus for a custom length" }),
    );

    await expectFocusOpenedIdle(api, "Write report");
  });
});

describe("Focus entry points that start a session", () => {
  let task: FakeTask;
  beforeEach(() => {
    task = fakeTask("Write report");
  });

  it("the quick-start menu's saved Pomo Timer starts exactly one session", async () => {
    const api = installFakeApi({
      tasks: [task],
      timers: [fakeTimer("Quick 15", { duration_seconds: 900 })],
    });
    render(<App />);

    const menu = await openQuickStartMenu(task.title);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Quick 15" }));

    await expectOneSessionStarted(api, 15, { task_id: task.id });
  });

  it("the quick-start menu's 25 min default starts exactly one session", async () => {
    const api = installFakeApi({ tasks: [task] });
    render(<App />);

    const menu = await openQuickStartMenu(task.title);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Focus: 25min" }));

    await expectOneSessionStarted(api, 25, { task_id: task.id });
  });

  it("the quick-start menu's Custom… minutes start exactly one session of that length", async () => {
    const api = installFakeApi({ tasks: [task] });
    render(<App />);

    const menu = await openQuickStartMenu(task.title);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Custom…" }));
    const input = screen.getByRole("spinbutton", { name: "Custom Pomo minutes" });
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    await expectOneSessionStarted(api, 12, { task_id: task.id });
  });

  it("the Start Pomo picker's saved Pomo Timer starts exactly one session", async () => {
    const api = installFakeApi({
      tasks: [task],
      timers: [fakeTimer("Quick 15", { duration_seconds: 900 })],
    });
    render(<App />);

    const dialog = await openActions(task.title);
    fireEvent.click(within(dialog).getByRole("option", { name: "Start Pomo" }));
    fireEvent.click(await within(dialog).findByRole("option", { name: "Quick 15" }));

    await expectOneSessionStarted(api, 15, { task_id: task.id });
  });

  it("the Start Pomo picker's 25 min default starts exactly one session", async () => {
    const api = installFakeApi({ tasks: [task] });
    render(<App />);

    const dialog = await openActions(task.title);
    fireEvent.click(within(dialog).getByRole("option", { name: "Start Pomo" }));
    fireEvent.click(await within(dialog).findByRole("option", { name: "Focus: 25min" }));

    await expectOneSessionStarted(api, 25, { task_id: task.id });
  });

  it("the Focus view's Start, after Open Focus, starts exactly one linked session", async () => {
    const api = installFakeApi({ tasks: [task] });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: `Open Focus for ${task.title}` }));
    await expectFocusOpenedIdle(api, task.title);
    fireEvent.click(main().getByRole("button", { name: "Start" }));

    await expectOneSessionStarted(api, 25, { task_id: task.id });
  });

  it("the Focus view's Start timer preset starts exactly one session", async () => {
    const api = installFakeApi({
      timers: [fakeTimer("Reading 30m", { duration_seconds: 1800 })],
    });
    render(<App />);
    const nav = await screen.findByRole("navigation", { name: "Views" });
    fireEvent.click(within(nav).getByRole("link", { name: "Focus" }));
    await screen.findByRole("heading", { name: "Focus" });

    fireEvent.click(await screen.findByRole("button", { name: "Start timer Reading 30m" }));

    await expectOneSessionStarted(api, 30, { task_id: null, habit_id: null });
  });
});
