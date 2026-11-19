import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeGoal, fakeHabit, fakeKeyResult, fakeTask, installFakeApi } from "./test/fakeApi";

/* jsdom applies no stylesheet, so the width threshold (a container query in
 * DayRail.css) is not observable here: these tests pin what the rail holds. */

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 3, 12));
});
afterEach(() => vi.useRealTimers());

const FOCUSED_GOAL_URL = "/api/v1/stand-up/focused-goal";

async function openToday(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "Today" }));
  await screen.findByRole("heading", { name: "Today" });
}

describe("Day rail", () => {
  it("shows the Focused Goal with its Score and days left, linking to Goals", async () => {
    const api = installFakeApi({
      goals: [
        fakeGoal("Ship", {
          start_date: "2026-07-01",
          end_date: "2026-07-05",
          is_focused: true,
          key_results: [fakeKeyResult(1, "Build", { target_value: 100, current_value: 25 })],
        }),
      ],
    });
    render(<App />);
    await openToday();
    const rail = await screen.findByRole("complementary", { name: "Day" });
    const card = await within(rail).findByRole("region", { name: "Focused goal" });
    expect(await within(card).findByText("Ship")).toBeInTheDocument();
    expect(within(card).getByRole("progressbar", { name: "Ship Score" })).toHaveAttribute(
      "aria-valuenow",
      "25",
    );
    expect(within(card).getByText("2 days left")).toBeInTheDocument();
    expect(api.requests.some((r) => r.method === "GET" && r.url === FOCUSED_GOAL_URL)).toBe(true);

    fireEvent.click(within(card).getByRole("link", { name: "Open Goals" }));
    expect(await screen.findByRole("heading", { name: "Goals" })).toBeInTheDocument();
  });

  it("says when there is no Focused Goal and offers to pick one", async () => {
    installFakeApi({ goals: [fakeGoal("Unfocused")] });
    render(<App />);
    await openToday();
    const card = await screen.findByRole("region", { name: "Focused goal" });
    expect(await within(card).findByText("No Focused Goal")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("link", { name: "Pick a Focused Goal" }));
    expect(await screen.findByRole("heading", { name: "Goals" })).toBeInTheDocument();
  });

  it("hides the card when Goals is disabled in Settings", async () => {
    const api = installFakeApi({
      goals: [fakeGoal("Ship", { is_focused: true })],
      sectionSettings: { calendar: true, goals: false, habits: true, focus: true, assistant: true },
      tasks: [fakeTask("Due", { due_date: "2026-07-03T00:00:00Z", is_all_day: true })],
    });
    render(<App />);
    await openToday();
    await screen.findByRole("button", { name: "Open details for Due" });
    expect(screen.queryByRole("region", { name: "Focused goal" })).not.toBeInTheDocument();
    expect(api.requests.some((r) => r.url === FOCUSED_GOAL_URL)).toBe(false);
  });

  it("is not shown beside other views", async () => {
    installFakeApi({ goals: [fakeGoal("Ship", { is_focused: true })] });
    render(<App />);
    await openToday();
    fireEvent.click(await screen.findByRole("button", { name: "Next 7 Days" }));
    await screen.findByRole("heading", { name: "Next 7 Days" });
    expect(screen.queryByRole("complementary", { name: "Day" })).not.toBeInTheDocument();
  });

  it("offers its own retry when the card fails, leaving Today's Tasks alone", async () => {
    const api = installFakeApi({
      goals: [fakeGoal("Ship", { is_focused: true })],
      tasks: [fakeTask("Due", { due_date: "2026-07-03T00:00:00Z", is_all_day: true })],
    });
    const realFetch = globalThis.fetch;
    let fail = true;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      if (fail && String(input).endsWith(FOCUSED_GOAL_URL)) {
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
    const card = await screen.findByRole("region", { name: "Focused goal" });
    const retry = await within(card).findByRole("button", { name: "Retry" });
    expect(within(card).getByText("Couldn't load the Focused Goal.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open details for Due" })).toBeInTheDocument();

    fail = false;
    fireEvent.click(retry);
    expect(await within(card).findByText("Ship")).toBeInTheDocument();
    await waitFor(() =>
      expect(api.requests.filter((r) => r.url === FOCUSED_GOAL_URL)).toHaveLength(1),
    );
  });
});

describe("Day rail Habits card", () => {
  async function card() {
    return screen.findByRole("region", { name: "Habits" });
  }

  it("lists only Habits scheduled today with done count, and checks in", async () => {
    const api = installFakeApi({
      habits: [
        fakeHabit("Meditate"),
        fakeHabit("Water", { type: "numeric", target: 3, step: 1, unit: "glasses" }),
        // 2026-07-03 is a Friday.
        fakeHabit("Monday only", { frequency: "FREQ=WEEKLY;BYDAY=MO" }),
        fakeHabit("Old", { is_archived: true }),
      ],
    });
    render(<App />);
    await openToday();
    const c = await card();
    expect(await within(c).findByText("0 of 2 done")).toBeInTheDocument();
    expect(within(c).queryByText("Monday only")).not.toBeInTheDocument();
    expect(within(c).queryByText("Old")).not.toBeInTheDocument();

    fireEvent.click(within(c).getByRole("button", { name: "Check in Meditate" }));
    expect(await within(c).findByText("1 of 2 done")).toBeInTheDocument();
    expect(within(c).getByText("Streak: 1")).toBeInTheDocument();
    fireEvent.click(within(c).getByRole("button", { name: "Add 1 to Water" }));
    expect(await within(c).findByText("1/3 glasses")).toBeInTheDocument();
    const puts = api.requests.filter((r) => r.method === "PUT");
    expect(puts.map((r) => [r.url, r.body])).toEqual([
      [expect.stringMatching(/\/check-ins\/2026-07-03$/), { value: 1 }],
      [expect.stringMatching(/\/check-ins\/2026-07-03$/), { value: 1 }],
    ]);
  });

  it("links to Habits", async () => {
    installFakeApi({ habits: [fakeHabit("Meditate")] });
    render(<App />);
    await openToday();
    fireEvent.click(await within(await card()).findByRole("link", { name: "Open Habits" }));
    expect(await screen.findByRole("heading", { name: "Habits" })).toBeInTheDocument();
  });

  it("is hidden when Habits is disabled, even with Goals on", async () => {
    const api = installFakeApi({
      habits: [fakeHabit("Meditate")],
      sectionSettings: { calendar: true, goals: true, habits: false, focus: true, assistant: true },
    });
    render(<App />);
    await openToday();
    await screen.findByRole("region", { name: "Focused goal" });
    expect(screen.queryByRole("region", { name: "Habits" })).not.toBeInTheDocument();
    expect(api.requests.some((r) => r.url.startsWith("/api/v1/check-ins"))).toBe(false);
  });

  it("shows the rail with only Habits when Goals is disabled", async () => {
    installFakeApi({
      habits: [fakeHabit("Meditate")],
      sectionSettings: { calendar: true, goals: false, habits: true, focus: true, assistant: true },
    });
    render(<App />);
    await openToday();
    expect(await card()).toBeInTheDocument();
  });

  it("fails in isolation with its own retry", async () => {
    installFakeApi({
      habits: [fakeHabit("Meditate")],
      goals: [fakeGoal("Ship", { is_focused: true })],
    });
    const realFetch = globalThis.fetch;
    let fail = true;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      if (fail && String(input).includes("/api/v1/check-ins")) {
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
    const c = await card();
    const retry = await within(c).findByRole("button", { name: "Retry" });
    expect(
      await within(await screen.findByRole("region", { name: "Focused goal" })).findByText("Ship"),
    ).toBeInTheDocument();
    fail = false;
    fireEvent.click(retry);
    expect(await within(c).findByText("0 of 1 done")).toBeInTheDocument();
  });
});
