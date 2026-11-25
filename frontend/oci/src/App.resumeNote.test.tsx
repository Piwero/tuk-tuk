import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeTask, installFakeApi } from "./test/fakeApi";

// Issue #554: an optional resume note on the Now selection, offered while
// a Focus Session is paused and shown with Now on return.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0));
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

function openToday(): void {
  window.history.replaceState(null, "", "/today");
  render(<App />);
}
const nowPanel = () => screen.findByRole("region", { name: "Now" });
const main = () => within(screen.getByRole("main"));

async function startAndPause(): Promise<void> {
  fireEvent.click(await within(await nowPanel()).findByRole("button", { name: "Start 5 min" }));
  await screen.findByRole("heading", { name: "Focus" });
  act(() => {
    vi.advanceTimersByTime(60_000);
  });
  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
}

async function returnToToday(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("button", { name: "Today" }));
  await screen.findByRole("heading", { name: "Today" });
  return nowPanel();
}

describe("Resume note", () => {
  it("is offered while paused, saved, and shown with Now on return", async () => {
    const task = fakeTask("Write report");
    const api = installFakeApi({ nowEnabled: true, tasks: [task], nowTaskId: task.id });
    openToday();
    expect(main().queryByLabelText("Resume note")).not.toBeInTheDocument();
    await startAndPause();

    fireEvent.change(await main().findByLabelText("Resume note"), {
      target: { value: "Reply to Ana's 2nd para" },
    });
    fireEvent.click(main().getByRole("button", { name: "Save note" }));
    expect(await main().findByText("Note saved")).toBeInTheDocument();
    expect(api.nowNote).toBe("Reply to Ana's 2nd para");

    const panel = await returnToToday();
    expect(await within(panel).findByText("Reply to Ana's 2nd para")).toBeInTheDocument();
  });

  it("can be edited and discarded", async () => {
    const task = fakeTask("Write report");
    const api = installFakeApi({
      nowEnabled: true,
      tasks: [task],
      nowTaskId: task.id,
      nowNote: "Old cue",
    });
    openToday();
    await startAndPause();

    const field = await main().findByLabelText("Resume note");
    expect(field).toHaveValue("Old cue");
    fireEvent.change(field, { target: { value: "New cue" } });
    fireEvent.click(main().getByRole("button", { name: "Save note" }));
    await main().findByText("Note saved");
    expect(api.nowNote).toBe("New cue");

    const panel = await returnToToday();
    fireEvent.click(await within(panel).findByRole("button", { name: "Discard note" }));
    await vi.waitFor(() => expect(within(panel).queryByText("New cue")).not.toBeInTheDocument());
    expect(api.nowNote).toBeNull();
  });

  it("keeps the text on a failed save, with the error on the field, and retries", async () => {
    const task = fakeTask("Write report");
    const api = installFakeApi({ nowEnabled: true, tasks: [task], nowTaskId: task.id });
    openToday();
    await startAndPause();
    api.failWrite = (method, pathname) => pathname === "/api/v1/now/note";

    const field = await main().findByLabelText("Resume note");
    fireEvent.change(field, { target: { value: "Pick up at step 3" } });
    fireEvent.click(main().getByRole("button", { name: "Save note" }));

    expect(await main().findByText("Couldn't save the note. Try again.")).toBeInTheDocument();
    expect(field).toHaveValue("Pick up at step 3");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription("Couldn't save the note. Try again.");

    api.failWrite = null;
    fireEvent.click(main().getByRole("button", { name: "Save note" }));
    expect(await main().findByText("Note saved")).toBeInTheDocument();
    expect(field).not.toHaveAttribute("aria-invalid");
    expect(api.nowNote).toBe("Pick up at step 3");
  });

  it("is cleared when the selection is removed", async () => {
    const task = fakeTask("Write report");
    const api = installFakeApi({
      nowEnabled: true,
      tasks: [task],
      nowTaskId: task.id,
      nowNote: "Cue",
    });
    openToday();
    const panel = await nowPanel();
    expect(await within(panel).findByText("Cue")).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: "Remove from Now" }));

    await vi.waitFor(() => expect(within(panel).queryByText("Cue")).not.toBeInTheDocument());
    expect(api.nowNote).toBeNull();
  });

  it("is cleared when the selected Task is completed elsewhere (pruned)", async () => {
    const task = fakeTask("Write report");
    const api = installFakeApi({
      nowEnabled: true,
      tasks: [task],
      nowTaskId: task.id,
      nowNote: "Cue",
    });
    api.tasks[0].completed = true;
    openToday();

    const panel = await nowPanel();
    expect(await within(panel).findByRole("button", { name: "Choose a Task" })).toBeInTheDocument();
    expect(within(panel).queryByText("Cue")).not.toBeInTheDocument();
    expect(api.nowNote).toBeNull();
  });

  it("is never required: finishing with no note records the session and leaves the Task open", async () => {
    const task = fakeTask("Write report");
    const api = installFakeApi({ nowEnabled: true, tasks: [task], nowTaskId: task.id });
    openToday();
    await startAndPause();
    await main().findByLabelText("Resume note");

    fireEvent.click(main().getByRole("button", { name: "Finish" }));

    await vi.waitFor(() => expect(api.focusSessions).toHaveLength(1));
    expect(api.tasks[0].completed).toBe(false);
    expect(api.nowNote).toBeNull();
  });
});
