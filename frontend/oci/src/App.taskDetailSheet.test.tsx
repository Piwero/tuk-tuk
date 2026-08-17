import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeList, fakeTask, INBOX, installFakeApi } from "./test/fakeApi";

/** jsdom applies no CSS, so the sheet's fixed positioning, the backdrop's
 * visibility, and the handle's appearance are only real in a browser (same
 * convention as App.layout.test.tsx and App.sidebarCollapse.test.tsx) —
 * these tests instead pin down the DOM/behavior the mobile presentation
 * depends on: the backdrop and handle exist and dismiss on click/swipe, the
 * origin List is named, and closing never disturbs main's scroll position. */

afterEach(() => {
  vi.restoreAllMocks();
});

async function openDetail(taskTitle: string): Promise<HTMLElement> {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: `Open details for ${taskTitle}` }));
  return await screen.findByRole("complementary", { name: "Task details" });
}

describe("Task detail sheet dismissal (issue #170)", () => {
  it("names the List the Task belongs to, even when opened from a cross-List view", async () => {
    const errands = fakeList("Errands");
    installFakeApi({
      lists: [INBOX, errands],
      tasks: [fakeTask("Buy milk", { list_id: errands.id })],
    });
    render(<App />);

    // "All" spans every List — opening a Task from there is the clearest
    // case where the sheet must say which List it actually belongs to,
    // since that's no longer implied by whatever view is behind it.
    const smartNav = await screen.findByRole("navigation", { name: "Smart Lists" });
    await userEvent.setup().click(within(smartNav).getByRole("button", { name: "All" }));
    await screen.findByRole("heading", { name: "All" });

    const panel = await openDetail("Buy milk");
    expect(panel).toHaveTextContent("Errands");
  });

  it("renders a backdrop that dismisses the sheet on click", async () => {
    installFakeApi({ tasks: [fakeTask("Write report")] });
    const user = userEvent.setup();
    render(<App />);

    await openDetail("Write report");
    const backdrop = document.querySelector(".task-detail-backdrop");
    expect(backdrop).not.toBeNull();

    await user.click(backdrop as Element);

    expect(screen.queryByRole("complementary", { name: "Task details" })).not.toBeInTheDocument();
  });

  it("renders a visible drag handle on the sheet", async () => {
    installFakeApi({ tasks: [fakeTask("Write report")] });
    render(<App />);

    const panel = await openDetail("Write report");
    expect(panel.querySelector(".task-detail-handle")).not.toBeNull();
  });

  it("dismisses on a downward swipe of the handle", async () => {
    installFakeApi({ tasks: [fakeTask("Write report")] });
    render(<App />);
    const panel = await openDetail("Write report");
    const handle = panel.querySelector(".task-detail-handle");
    expect(handle).not.toBeNull();

    fireEvent.touchStart(handle as Element, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(handle as Element, { touches: [{ clientY: 200 }] });
    fireEvent.touchEnd(handle as Element);

    await waitFor(() =>
      expect(screen.queryByRole("complementary", { name: "Task details" })).not.toBeInTheDocument(),
    );
  });

  it("ignores a short drag, and an upward swipe, of the handle", async () => {
    installFakeApi({ tasks: [fakeTask("Write report")] });
    render(<App />);
    const panel = await openDetail("Write report");
    const handle = panel.querySelector(".task-detail-handle") as Element;

    fireEvent.touchStart(handle, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(handle, { touches: [{ clientY: 130 }] });
    fireEvent.touchEnd(handle);
    expect(screen.getByRole("complementary", { name: "Task details" })).toBeInTheDocument();

    fireEvent.touchStart(handle, { touches: [{ clientY: 200 }] });
    fireEvent.touchMove(handle, { touches: [{ clientY: 100 }] });
    fireEvent.touchEnd(handle);
    expect(screen.getByRole("complementary", { name: "Task details" })).toBeInTheDocument();
  });

  it("still closes from the Close button, independent of the gesture handler", async () => {
    installFakeApi({ tasks: [fakeTask("Write report")] });
    const user = userEvent.setup();
    render(<App />);
    const panel = await openDetail("Write report");

    await user.click(within(panel).getByRole("button", { name: "Close details" }));

    expect(screen.queryByRole("complementary", { name: "Task details" })).not.toBeInTheDocument();
  });

  it("preserves main's scroll position across opening and dismissing the sheet", async () => {
    installFakeApi({ tasks: [fakeTask("Write report")] });
    render(<App />);

    const main = document.querySelector("main") as HTMLElement;
    Object.defineProperty(main, "scrollTop", { writable: true, value: 0 });
    main.scrollTop = 240;

    const panel = await openDetail("Write report");
    expect(main.scrollTop).toBe(240);

    fireEvent.click(document.querySelector(".task-detail-backdrop") as Element);
    await waitFor(() =>
      expect(screen.queryByRole("complementary", { name: "Task details" })).not.toBeInTheDocument(),
    );
    expect(main.scrollTop).toBe(240);
    // Also confirm we're genuinely back at the prior view, not somewhere else.
    expect(panel).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument();
  });
});
