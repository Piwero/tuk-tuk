import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { openCalendar, openDay, pinCalendarClock } from "./test/calendar";
import { closestOrThrow } from "./test/dnd";
import { fakeTask, installFakeApi } from "./test/fakeApi";

/** An Unscheduled card offered only a checkbox on a phone: no tap to open
 * the Task, and HTML5 drag-and-drop never starts from a touch, so it could
 * not be dragged onto the grid either. A tap now opens the Task detail
 * panel, and a press-and-hold picks the card up for a touch drag. */

pinCalendarClock();

function tick(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

async function unscheduledCard(title: string): Promise<HTMLElement> {
  const panel = await screen.findByRole("complementary", { name: "Unscheduled" });
  return closestOrThrow(await within(panel).findByText(title), "li");
}

/** jsdom never lays out, so `elementFromPoint` is absent: the touch drag's
 * hit test is pinned to whatever element the test says sits under the
 * finger. */
let underFinger: Element | null = null;
beforeEach(() => {
  underFinger = null;
  document.elementFromPoint = () => underFinger;
});
afterEach(() => {
  Reflect.deleteProperty(document, "elementFromPoint");
});

const at = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] });
const releasedAt = (x: number, y: number) => ({
  touches: [],
  changedTouches: [{ clientX: x, clientY: y }],
});

describe("Opening an Unscheduled task", () => {
  it("opens the Task detail panel when the card is clicked", async () => {
    installFakeApi({ tasks: [fakeTask("Someday")] });
    render(<App />);
    await openDay();

    fireEvent.click(await unscheduledCard("Someday"));

    const details = await screen.findByRole("complementary", { name: "Task details" });
    expect(within(details).getByDisplayValue("Someday")).toBeInTheDocument();
  });

  it("does not open the Task when its checkbox is ticked", async () => {
    installFakeApi({ tasks: [fakeTask("Someday")] });
    render(<App />);
    await openDay();

    const card = await unscheduledCard("Someday");
    fireEvent.click(within(card).getByRole("checkbox", { name: "Complete Someday" }));

    expect(screen.queryByLabelText("Task details")).toBeNull();
  });

  it("closes the narrow-screen sheet so the opened Task is not left behind it", async () => {
    const width = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    try {
      installFakeApi({ tasks: [fakeTask("Someday")] });
      render(<App />);
      await openDay();
      fireEvent.click(screen.getByRole("button", { name: "Show Unscheduled" }));
      const panel = screen.getByRole("complementary", { name: "Unscheduled" });
      expect(panel).toHaveAttribute("data-open");

      fireEvent.click(await unscheduledCard("Someday"));

      expect(panel).not.toHaveAttribute("data-open");
      expect(await screen.findByRole("complementary", { name: "Task details" })).toBeVisible();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    }
  });
});

describe("Touch-dragging an Unscheduled task onto the calendar", () => {
  it("schedules a one-hour block on the hour cell it is released over", async () => {
    const api = installFakeApi({ tasks: [fakeTask("Errand")] });
    render(<App />);
    await openDay();

    const card = await unscheduledCard("Errand");
    fireEvent.touchStart(card, at(20, 700));
    tick(500);
    underFinger = screen.getByLabelText("2026-07-03 09:00");
    fireEvent.touchMove(card, at(120, 200));
    fireEvent.touchEnd(card, releasedAt(120, 200));

    await waitFor(() => {
      expect(api.tasks.find((task) => task.title === "Errand")).toMatchObject({
        start_date: "2026-07-03T09:00:00.000Z",
        due_date: "2026-07-03T10:00:00.000Z",
      });
    });
  });

  it("schedules an all-day task on the Month cell it is released over", async () => {
    const api = installFakeApi({ tasks: [fakeTask("Errand")] });
    render(<App />);
    await openCalendar();

    const card = await unscheduledCard("Errand");
    fireEvent.touchStart(card, at(20, 700));
    tick(500);
    // The finger lands on the cell's date number, inside the cell.
    underFinger = screen.getByLabelText("2026-07-15").firstElementChild;
    fireEvent.touchMove(card, at(120, 200));
    fireEvent.touchEnd(card, releasedAt(120, 200));

    await waitFor(() => {
      expect(api.tasks.find((task) => task.title === "Errand")).toMatchObject({
        due_date: "2026-07-15T00:00:00Z",
        is_all_day: true,
      });
    });
  });

  it("shows the picked-up card under the finger and marks the slot it would land in", async () => {
    installFakeApi({ tasks: [fakeTask("Errand")] });
    render(<App />);
    await openDay();

    const card = await unscheduledCard("Errand");
    fireEvent.touchStart(card, at(20, 700));
    tick(500);
    const ghost = document.querySelector(".touch-drag-ghost");
    expect(ghost).toHaveTextContent("Errand");

    const slot = screen.getByLabelText("2026-07-03 09:00");
    underFinger = slot;
    fireEvent.touchMove(card, at(120, 200));
    expect(slot).toHaveAttribute("data-drop-over");

    fireEvent.touchEnd(card, releasedAt(120, 200));
    expect(document.querySelector(".touch-drag-ghost")).toBeNull();
    expect(slot).not.toHaveAttribute("data-drop-over");
  });

  it("puts the narrow-screen sheet away once the card is picked up, uncovering the grid", async () => {
    const width = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    try {
      installFakeApi({ tasks: [fakeTask("Errand")] });
      render(<App />);
      await openDay();
      fireEvent.click(screen.getByRole("button", { name: "Show Unscheduled" }));
      const panel = screen.getByRole("complementary", { name: "Unscheduled" });

      fireEvent.touchStart(await unscheduledCard("Errand"), at(20, 700));
      tick(500);

      expect(panel).not.toHaveAttribute("data-open");
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    }
  });

  it("leaves a quick swipe to the list's own scrolling", async () => {
    const api = installFakeApi({ tasks: [fakeTask("Errand")] });
    render(<App />);
    await openDay();

    const card = await unscheduledCard("Errand");
    fireEvent.touchStart(card, at(20, 700));
    fireEvent.touchMove(card, at(20, 640));
    tick(500);
    underFinger = screen.getByLabelText("2026-07-03 09:00");
    fireEvent.touchEnd(card, releasedAt(20, 640));

    expect(document.querySelector(".touch-drag-ghost")).toBeNull();
    tick(1000);
    expect(api.tasks.find((task) => task.title === "Errand")?.due_date).toBeNull();
  });

  it("saves nothing when released away from any slot", async () => {
    const api = installFakeApi({ tasks: [fakeTask("Errand")] });
    render(<App />);
    await openDay();

    const card = await unscheduledCard("Errand");
    fireEvent.touchStart(card, at(20, 700));
    tick(500);
    underFinger = document.body;
    fireEvent.touchEnd(card, releasedAt(5, 5));

    tick(1000);
    expect(api.tasks.find((task) => task.title === "Errand")?.due_date).toBeNull();
    expect(document.querySelector(".touch-drag-ghost")).toBeNull();
  });
});
