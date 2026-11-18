import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { LONG_PRESS_MS } from "./longPressReveal";
import { fakeTask, installFakeApi } from "./test/fakeApi";

// Friday 2026-07-03, local noon (TZ=UTC suite-wide).
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0));
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Focus opened with `title` linked, idle, the 25 min length ready. */
async function expectFocusReadyFor(title: string): Promise<void> {
  expect(await screen.findByRole("heading", { name: "Focus" })).toBeInTheDocument();
  const main = within(screen.getByRole("main"));
  expect(await main.findByRole("button", { name: `Linked: ${title}` })).toBeInTheDocument();
  expect(main.getByRole("button", { name: "Start" })).toBeInTheDocument();
  expect(main.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
  expect(main.getByRole("button", { name: "25 min" })).toHaveAttribute("aria-pressed", "true");
  expect(main.getByText("25:00")).toBeInTheDocument();
}

function noFocusSessionWrites(api: ReturnType<typeof installFakeApi>): void {
  expect(
    api.requests.filter((r) => r.method !== "GET" && r.url.startsWith("/api/v1/focus-sessions")),
  ).toEqual([]);
}

describe("Focus action on a Task row", () => {
  it("opens Focus with the Task linked and does not start the clock", async () => {
    const api = installFakeApi({ tasks: [fakeTask("Write report")] });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Focus on Write report" }));

    await expectFocusReadyFor("Write report");
    noFocusSessionWrites(api);
    expect(api.focusSessions).toHaveLength(0);
  });

  it("is reachable by Tab right after the row's title", async () => {
    installFakeApi({ tasks: [fakeTask("Write report")] });
    render(<App />);
    const row = (
      await screen.findByRole("button", { name: "Open details for Write report" })
    ).closest("li") as HTMLElement;

    const focusable = Array.from(
      row.querySelectorAll<HTMLElement>("button, input, [tabindex]"),
    ).filter((el) => el.tabIndex >= 0);
    const names = focusable.map((el) => el.getAttribute("aria-label"));
    expect(names).toContain("Focus on Write report");
    expect(names.indexOf("Focus on Write report")).toBeLessThan(
      names.indexOf("Actions for Write report"),
    );
  });

  it("is a Task action in the command palette and opens Focus without starting", async () => {
    const api = installFakeApi({ tasks: [fakeTask("Write report")] });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Actions for Write report" }));
    const dialog = await screen.findByRole("dialog", { name: "Actions for Write report" });
    fireEvent.click(within(dialog).getByRole("option", { name: "Focus" }));

    await expectFocusReadyFor("Write report");
    noFocusSessionWrites(api);
  });

  it("sits in the long-press reveal, closed at rest", async () => {
    installFakeApi({ tasks: [fakeTask("Write report")] });
    render(<App />);
    const focusButton = await screen.findByRole("button", { name: "Focus on Write report" });
    const row = focusButton.closest("li") as HTMLElement;

    expect(row).not.toHaveAttribute("data-actions-open");
    expect(focusButton.closest(".row-actions")).not.toBeNull();

    fireEvent.touchStart(row);
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    fireEvent.touchEnd(row);

    expect(row).toHaveAttribute("data-actions-open", "true");
    expect(within(row).getByRole("button", { name: "Focus on Write report" })).toBeVisible();
  });

  it("is absent when Focus is disabled in Settings", async () => {
    installFakeApi({
      tasks: [fakeTask("Write report")],
      sectionSettings: { calendar: true, goals: true, habits: true, focus: false, assistant: true },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Actions for Write report" }));
    const dialog = await screen.findByRole("dialog", { name: "Actions for Write report" });

    expect(within(dialog).queryByRole("option", { name: "Focus" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Focus on Write report" })).not.toBeInTheDocument();
  });
});
