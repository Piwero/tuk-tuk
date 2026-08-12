import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeTask, fakeTimer, installFakeApi } from "./test/fakeApi";

// All tests pin the clock to Friday 2026-07-03, local noon, so timers and
// "today" are deterministic in any timezone.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0));
  // A running Focus session persists itself; tests must not inherit one.
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

function tick(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("Pomo quick-start menu", () => {
  it("right-click opens a menu listing saved Pomo Timers and starts a linked session", async () => {
    const task = fakeTask("Write report");
    installFakeApi({
      tasks: [task],
      timers: [
        fakeTimer("Deep Work 50", { duration_seconds: 3000 }),
        fakeTimer("Quick 15", { duration_seconds: 900 }),
      ],
    });
    render(<App />);
    const row = await screen.findByRole("button", { name: "Open details for Write report" });

    fireEvent.contextMenu(row.closest("li") as HTMLElement);

    const menu = await screen.findByRole("menu", { name: "Start Focus for Write report" });
    expect(within(menu).getByRole("menuitem", { name: "Deep Work 50" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Quick 15" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Custom…" })).toBeInTheDocument();

    fireEvent.click(within(menu).getByRole("menuitem", { name: "Deep Work 50" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Focus timer running, 50:00 left" }),
      ).toBeInTheDocument(),
    );
    // Still on the List view: no navigation happened.
    expect(
      screen.getByRole("button", { name: "Open details for Write report" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Focus timer running, 50:00 left" }));
    expect(await screen.findByRole("combobox", { name: "Link" })).toHaveValue(`task:${task.id}`);
  });

  it("shows a built-in 25 min default plus Custom… when there are no saved Pomo Timers", async () => {
    const task = fakeTask("Write report");
    installFakeApi({ tasks: [task] });
    render(<App />);
    const row = await screen.findByRole("button", { name: "Open details for Write report" });

    fireEvent.contextMenu(row.closest("li") as HTMLElement);

    const menu = await screen.findByRole("menu", { name: "Start Focus for Write report" });
    expect(within(menu).getByRole("menuitem", { name: "25 min" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Custom…" })).toBeInTheDocument();
  });

  it("Custom… accepts a typed number of minutes and starts a Pomo of that length", async () => {
    const task = fakeTask("Write report");
    installFakeApi({ tasks: [task] });
    render(<App />);
    const row = await screen.findByRole("button", { name: "Open details for Write report" });

    fireEvent.contextMenu(row.closest("li") as HTMLElement);
    const menu = await screen.findByRole("menu", { name: "Start Focus for Write report" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Custom…" }));

    const input = screen.getByRole("spinbutton", { name: "Custom Pomo minutes" });
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Focus timer running, 12:00 left" }),
      ).toBeInTheDocument(),
    );
  });

  it("Escape from the Custom… input reverts to the row list without closing the menu", async () => {
    const task = fakeTask("Write report");
    installFakeApi({ tasks: [task] });
    render(<App />);
    const row = await screen.findByRole("button", { name: "Open details for Write report" });

    fireEvent.contextMenu(row.closest("li") as HTMLElement);
    const menu = await screen.findByRole("menu", { name: "Start Focus for Write report" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Custom…" }));

    const input = screen.getByRole("spinbutton", { name: "Custom Pomo minutes" });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(
      await screen.findByRole("menu", { name: "Start Focus for Write report" }),
    ).toBeInTheDocument();
  });

  it("links the started session to the right-clicked Task even when the Timer links elsewhere", async () => {
    const task = fakeTask("Write report");
    const otherTask = fakeTask("Other task");
    installFakeApi({
      tasks: [task, otherTask],
      timers: [fakeTimer("Deep Work 50", { duration_seconds: 3000, task_id: otherTask.id })],
    });
    render(<App />);
    const row = await screen.findByRole("button", { name: "Open details for Write report" });

    fireEvent.contextMenu(row.closest("li") as HTMLElement);
    const menu = await screen.findByRole("menu", { name: "Start Focus for Write report" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Deep Work 50" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Focus timer running, 50:00 left" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Focus timer running, 50:00 left" }));
    expect(await screen.findByRole("combobox", { name: "Link" })).toHaveValue(`task:${task.id}`);
  });

  it("existing Focus button behavior is unchanged", async () => {
    const task = fakeTask("Write report");
    installFakeApi({ tasks: [task] });
    render(<App />);
    await screen.findByRole("button", { name: "Open details for Write report" });

    fireEvent.click(screen.getByRole("button", { name: "Start Focus for Write report" }));

    expect(await screen.findByRole("heading", { name: "Focus" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(await screen.findByRole("combobox", { name: "Link" })).toHaveValue(`task:${task.id}`);
  });

  it("closes the menu on outside click", async () => {
    const task = fakeTask("Write report");
    installFakeApi({ tasks: [task] });
    render(<App />);
    const row = await screen.findByRole("button", { name: "Open details for Write report" });

    fireEvent.contextMenu(row.closest("li") as HTMLElement);
    await screen.findByRole("menu", { name: "Start Focus for Write report" });

    fireEvent.mouseDown(document.body);

    expect(
      screen.queryByRole("menu", { name: "Start Focus for Write report" }),
    ).not.toBeInTheDocument();
  });

  it("closes the menu on Escape", async () => {
    const task = fakeTask("Write report");
    installFakeApi({ tasks: [task] });
    render(<App />);
    const row = await screen.findByRole("button", { name: "Open details for Write report" });

    fireEvent.contextMenu(row.closest("li") as HTMLElement);
    await screen.findByRole("menu", { name: "Start Focus for Write report" });

    fireEvent.keyDown(document, { key: "Escape" });

    expect(
      screen.queryByRole("menu", { name: "Start Focus for Write report" }),
    ).not.toBeInTheDocument();
  });

  it("confirms before finishing a running session and starting the new one", async () => {
    const task = fakeTask("Write report");
    const otherTask = fakeTask("Other task");
    const api = installFakeApi({ tasks: [task, otherTask] });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);

    // Start a run against the other task via the existing Focus button.
    fireEvent.click(
      await screen.findByRole("button", { name: `Start Focus for ${otherTask.title}` }),
    );
    await screen.findByRole("heading", { name: "Focus" });
    tick(60_000);

    // Back to the List view.
    const listsNav = await screen.findByRole("navigation", { name: "Lists" });
    fireEvent.click(within(listsNav).getByRole("button", { name: "Inbox" }));

    const row = await screen.findByRole("button", { name: "Open details for Write report" });
    fireEvent.contextMenu(row.closest("li") as HTMLElement);
    const menu = await screen.findByRole("menu", { name: "Start Focus for Write report" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "25 min" }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(api.focusSessions).toHaveLength(1));
    expect(api.focusSessions[0]?.task_id).toBe(otherTask.id);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Focus timer running, 25:00 left" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Focus timer running, 25:00 left" }));
    expect(await screen.findByRole("combobox", { name: "Link" })).toHaveValue(`task:${task.id}`);
  });

  it("canceling the confirm leaves the running session untouched and starts nothing", async () => {
    const task = fakeTask("Write report");
    const otherTask = fakeTask("Other task");
    const api = installFakeApi({ tasks: [task, otherTask] });
    render(<App />);

    fireEvent.click(
      await screen.findByRole("button", { name: `Start Focus for ${otherTask.title}` }),
    );
    await screen.findByRole("heading", { name: "Focus" });

    const listsNav = await screen.findByRole("navigation", { name: "Lists" });
    fireEvent.click(within(listsNav).getByRole("button", { name: "Inbox" }));

    const row = await screen.findByRole("button", { name: "Open details for Write report" });
    fireEvent.contextMenu(row.closest("li") as HTMLElement);
    const menu = await screen.findByRole("menu", { name: "Start Focus for Write report" });

    vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "25 min" }));

    expect(window.confirm).toHaveBeenCalled();
    expect(api.focusSessions).toHaveLength(0);
    // The original run against otherTask is still going, unlinked to task.
    expect(screen.getByRole("button", { name: /Focus timer running/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Focus timer running/ }));
    expect(await screen.findByRole("combobox", { name: "Link" })).toHaveValue(
      `task:${otherTask.id}`,
    );
  });

  it("kebab button opens the menu just like right-click", async () => {
    const task = fakeTask("Write report");
    installFakeApi({
      tasks: [task],
      timers: [fakeTimer("Deep Work 50", { duration_seconds: 3000 })],
    });
    render(<App />);
    await screen.findByRole("button", { name: "Open details for Write report" });

    fireEvent.click(
      screen.getByRole("button", { name: `Pomo quick-start menu for ${task.title}` }),
    );

    const menu = await screen.findByRole("menu", { name: "Start Focus for Write report" });
    expect(within(menu).getByRole("menuitem", { name: "Deep Work 50" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Custom…" })).toBeInTheDocument();
  });

  it("kebab button starts a Pomo session with the same behavior as right-click", async () => {
    const task = fakeTask("Write report");
    installFakeApi({
      tasks: [task],
      timers: [fakeTimer("Deep Work 50", { duration_seconds: 3000 })],
    });
    render(<App />);
    await screen.findByRole("button", { name: "Open details for Write report" });

    fireEvent.click(
      screen.getByRole("button", { name: `Pomo quick-start menu for ${task.title}` }),
    );

    const menu = await screen.findByRole("menu", { name: "Start Focus for Write report" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Deep Work 50" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Focus timer running, 50:00 left" }),
      ).toBeInTheDocument(),
    );
    // Still on the List view: no navigation happened.
    expect(
      screen.getByRole("button", { name: "Open details for Write report" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Focus timer running, 50:00 left" }));
    expect(await screen.findByRole("combobox", { name: "Link" })).toHaveValue(`task:${task.id}`);
  });

  it("kebab button closes the menu on Escape", async () => {
    const task = fakeTask("Write report");
    installFakeApi({ tasks: [task] });
    render(<App />);
    await screen.findByRole("button", { name: "Open details for Write report" });

    fireEvent.click(
      screen.getByRole("button", { name: `Pomo quick-start menu for ${task.title}` }),
    );

    await screen.findByRole("menu", { name: "Start Focus for Write report" });

    fireEvent.keyDown(document, { key: "Escape" });

    expect(
      screen.queryByRole("menu", { name: "Start Focus for Write report" }),
    ).not.toBeInTheDocument();
  });

  it("kebab button closes the menu on outside click", async () => {
    const task = fakeTask("Write report");
    installFakeApi({ tasks: [task] });
    render(<App />);
    await screen.findByRole("button", { name: "Open details for Write report" });

    fireEvent.click(
      screen.getByRole("button", { name: `Pomo quick-start menu for ${task.title}` }),
    );

    await screen.findByRole("menu", { name: "Start Focus for Write report" });

    fireEvent.mouseDown(document.body);

    expect(
      screen.queryByRole("menu", { name: "Start Focus for Write report" }),
    ).not.toBeInTheDocument();
  });
});
