import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeFocusSession, fakeTask, installFakeApi } from "./test/fakeApi";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 3, 12));
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

const STATS_URL = "/api/v1/focus-stats?start=2026-07-03&end=2026-07-03&tz=UTC";

async function openToday(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "Today" }));
  await screen.findByRole("heading", { name: "Today" });
}

async function focusCard(): Promise<ReturnType<typeof within>> {
  const rail = await screen.findByRole("complementary", { name: "Day" });
  return within(await within(rail).findByRole("region", { name: "Focus" }));
}

describe("Day rail: Focus card", () => {
  it("shows today's Focus total and Pomos of the cycle, linking to Focus", async () => {
    const api = installFakeApi({
      focusSessions: [
        fakeFocusSession({ started_at: "2026-07-02T09:00:00Z", ended_at: "2026-07-02T10:00:00Z" }),
        fakeFocusSession({ started_at: "2026-07-03T09:00:00Z", ended_at: "2026-07-03T10:15:00Z" }),
      ],
    });
    render(<App />);
    await openToday();
    const card = await focusCard();
    expect(await card.findByText("1 h 15 min")).toBeInTheDocument();
    expect(card.getByText("0 of 4 Pomos")).toBeInTheDocument();
    expect(api.requests.some((r) => r.method === "GET" && r.url === STATS_URL)).toBe(true);

    fireEvent.click(card.getByRole("link", { name: "Open Focus" }));
    expect(await screen.findByRole("heading", { name: "Focus" })).toBeInTheDocument();
  });

  it("updates after a Focus Session finishes", async () => {
    installFakeApi();
    render(<App />);
    const nav = await screen.findByRole("navigation", { name: "Views" });
    fireEvent.click(within(nav).getByRole("link", { name: "Focus" }));
    await screen.findByRole("heading", { name: "Focus" });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await openToday();
    const card = await focusCard();
    expect(await card.findByText("0 min")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(25 * 60_000);
    });
    expect(await card.findByText("25 min")).toBeInTheDocument();
    expect(card.getByText("1 of 4 Pomos")).toBeInTheDocument();
  });

  it("is hidden when Focus is disabled", async () => {
    const api = installFakeApi({
      sectionSettings: { calendar: true, goals: true, habits: true, focus: false, assistant: true },
    });
    render(<App />);
    await openToday();
    await screen.findByRole("region", { name: "Focused goal" });
    expect(screen.queryByRole("region", { name: "Focus" })).not.toBeInTheDocument();
    expect(api.requests.some((r) => r.url.startsWith("/api/v1/focus-stats"))).toBe(false);
  });

  it("shows the rail for Focus alone when Goals is disabled", async () => {
    installFakeApi({
      sectionSettings: { calendar: true, goals: false, habits: true, focus: true, assistant: true },
    });
    render(<App />);
    await openToday();
    expect(await (await focusCard()).findByText("0 min")).toBeInTheDocument();
  });

  it("fails in isolation with its own retry", async () => {
    installFakeApi({
      tasks: [fakeTask("Due", { due_date: "2026-07-03T00:00:00Z", is_all_day: true })],
    });
    const realFetch = globalThis.fetch;
    let fail = true;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      if (fail && String(input).includes("/api/v1/focus-stats")) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: { code: "internal_error", message: "boom" } }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return realFetch(input, init);
    });
    render(<App />);
    await openToday();
    const card = await focusCard();
    expect(await card.findByRole("alert")).toHaveTextContent("Couldn't load today's Focus.");
    expect(screen.getByRole("button", { name: "Open details for Due" })).toBeInTheDocument();
    expect(await screen.findByText("No Focused Goal")).toBeInTheDocument();
    fail = false;
    fireEvent.click(card.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(card.getByText("0 min")).toBeInTheDocument());
  });
});
