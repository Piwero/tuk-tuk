import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { pinCalendarClock } from "./test/calendar";
import { fakeTask, installFakeApi } from "./test/fakeApi";

/** Below the narrow breakpoint the Calendar has to behave like a phone
 * screen, not a squeezed desktop grid (issue #169). jsdom never lays out
 * (no real `document.scrollWidth`, no `matchMedia`), so these tests pin
 * down what CalendarView.tsx can be held to structurally: which mode it
 * defaults to, what a Month cell renders instead of a full entry list, and
 * that the Unscheduled panel's opener/backdrop wiring is present — the
 * `minmax(0, 1fr)` grid-track fix and the panel's off-canvas CSS itself are
 * a real-browser concern verified by inspection, the same limitation
 * App.layout.test.tsx documents for the shell's independent-scroll CSS. */

pinCalendarClock();

const NARROW_WIDTH = 390;
const WIDE_WIDTH = 1024;

function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: width,
  });
}

beforeEach(() => {
  setViewportWidth(NARROW_WIDTH);
});

afterEach(() => {
  setViewportWidth(WIDE_WIDTH);
});

describe("The Calendar below the narrow breakpoint", () => {
  it("shows three days on mobile and pages without skipping dates", async () => {
    installFakeApi({
      tasks: [
        fakeTask("Monday task", { due_date: "2026-07-06", is_all_day: true }),
        fakeTask("Spanning task", {
          start_date: "2026-07-02",
          due_date: "2026-07-04",
          is_all_day: true,
        }),
      ],
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("link", { name: "Calendar" }));
    await screen.findByRole("heading", { name: "Friday, July 3, 2026" });
    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    await screen.findByRole("heading", { name: "Jul 3 – Jul 5, 2026" });
    expect(document.querySelectorAll(".day-column")).toHaveLength(3);
    await screen.findByText("Spanning task");
    fireEvent.click(screen.getByRole("button", { name: "Next 3 days" }));
    await screen.findByRole("heading", { name: "Jul 6 – Jul 8, 2026" });
    await screen.findByText("Monday task");
    fireEvent.click(screen.getByRole("button", { name: "Previous 3 days" }));
    await screen.findByRole("heading", { name: "Jul 3 – Jul 5, 2026" });
    fireEvent.click(screen.getByRole("button", { name: "Next 3 days" }));
    fireEvent.click(screen.getByRole("button", { name: "Go to today" }));
    await screen.findByRole("heading", { name: "Jul 3 – Jul 5, 2026" });
    setViewportWidth(WIDE_WIDTH);
    fireEvent(window, new Event("resize"));
    await screen.findByRole("heading", { name: "Jun 29 – Jul 5, 2026" });
    expect(document.querySelectorAll(".day-column")).toHaveLength(7);
  });

  it("ignores a delayed mobile range after widening to the full week", async () => {
    installFakeApi({
      tasks: [fakeTask("Wednesday task", { due_date: "2026-07-01", is_all_day: true })],
    });
    const fetchApi = globalThis.fetch;
    let release: (() => void) | undefined;
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await fetchApi(input, init);
      if (String(input).includes("range_start=2026-07-03&range_end=2026-07-05")) {
        await delayed;
      }
      return response;
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("link", { name: "Calendar" }));
    await screen.findByRole("heading", { name: "Friday, July 3, 2026" });
    fireEvent.click(screen.getByRole("button", { name: "Week" }));
    await screen.findByRole("heading", { name: "Jul 3 – Jul 5, 2026" });
    await waitFor(() =>
      expect(
        vi
          .mocked(fetchApi)
          .mock.calls.some(([input]) => String(input).includes("range_end=2026-07-05")),
      ).toBe(true),
    );
    setViewportWidth(WIDE_WIDTH);
    fireEvent(window, new Event("resize"));
    await screen.findByText("Wednesday task");
    await act(async () => {
      release?.();
      await delayed;
    });
    expect(screen.getByText("Wednesday task")).toBeInTheDocument();
  });

  it("defaults to Day, same as any width", async () => {
    installFakeApi();
    render(<App />);

    fireEvent.click(await screen.findByRole("link", { name: "Calendar" }));

    // Day's heading (today, per pinCalendarClock) — not Month's "July 2026".
    await screen.findByRole("heading", { name: "Friday, July 3, 2026" });
    expect(screen.queryByRole("heading", { name: "July 2026" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Day" })).toHaveAttribute("aria-pressed", "true");
  });

  it("still reaches Month on request, condensed to date + entry count rather than titles", async () => {
    installFakeApi({
      tasks: [
        fakeTask("Standup", {
          start_date: "2026-07-06T09:00:00Z",
          due_date: "2026-07-06T09:30:00Z",
          time_zone: "UTC",
        }),
      ],
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("link", { name: "Calendar" }));
    await screen.findByRole("heading", { name: "Friday, July 3, 2026" });
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    await screen.findByRole("heading", { name: "July 2026" });

    // The date number is still there...
    const standupDay = await screen.findByLabelText("2026-07-06");
    expect(within(standupDay).getByText("6")).toBeInTheDocument();
    // ...a count stands in for the entry...
    expect(within(standupDay).getByLabelText("1 entry")).toHaveTextContent("1");
    // ...but the full title/time row a wide screen shows is gone.
    expect(within(standupDay).queryByText("Standup")).not.toBeInTheDocument();
    expect(within(standupDay).queryByText("09:00")).not.toBeInTheDocument();
  });

  it("keeps a full title list once the viewport widens past the breakpoint", async () => {
    installFakeApi({
      tasks: [
        fakeTask("Standup", {
          start_date: "2026-07-06T09:00:00Z",
          due_date: "2026-07-06T09:30:00Z",
          time_zone: "UTC",
        }),
      ],
    });
    setViewportWidth(WIDE_WIDTH);
    render(<App />);

    fireEvent.click(await screen.findByRole("link", { name: "Calendar" }));
    await screen.findByRole("heading", { name: "Friday, July 3, 2026" });
    fireEvent.click(screen.getByRole("button", { name: "Month" }));
    await screen.findByRole("heading", { name: "July 2026" });

    const standupDay = await screen.findByLabelText("2026-07-06");
    expect(within(standupDay).getByText("Standup")).toBeInTheDocument();
    expect(within(standupDay).queryByLabelText("1 entry")).not.toBeInTheDocument();
  });

  it("moves the Unscheduled panel behind an opener instead of the always-open side panel", async () => {
    installFakeApi({ tasks: [fakeTask("Someday")] });
    render(<App />);

    fireEvent.click(await screen.findByRole("link", { name: "Calendar" }));
    await screen.findByRole("heading", { name: "Friday, July 3, 2026" });

    const panel = screen.getByRole("complementary", { name: "Unscheduled" });
    expect(panel).not.toHaveAttribute("data-open");

    const toggle = screen.getByRole("button", { name: "Show Unscheduled" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(panel).toHaveAttribute("data-open");
    // The Task itself is still there once opened.
    expect(within(panel).getByText("Someday")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(panel).not.toHaveAttribute("data-open");
  });
});
