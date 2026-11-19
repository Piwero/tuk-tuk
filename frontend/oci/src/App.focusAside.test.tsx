import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeFocusSession, fakeHabit, fakeTask, installFakeApi } from "./test/fakeApi";

// Friday 2026-07-03, local noon (TZ=UTC suite-wide). Week starts Mon Jun 29.
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0));
});
afterEach(() => {
  vi.useRealTimers();
});

function session(day: string, minutes: number): ReturnType<typeof fakeFocusSession> {
  const start = new Date(`${day}T09:00:00Z`);
  return fakeFocusSession({
    started_at: start.toISOString(),
    ended_at: new Date(start.getTime() + minutes * 60_000).toISOString(),
  });
}

it("lists today's Tasks; clicking one links it and the headline matches", async () => {
  const api = installFakeApi({
    tasks: [
      fakeTask("Write report", { due_date: "2026-07-03T00:00:00Z", is_all_day: true }),
      fakeTask("Later thing", { due_date: "2026-07-20T00:00:00Z", is_all_day: true }),
    ],
  });
  window.history.replaceState(null, "", "/focus");
  render(<App />);
  const list = await screen.findByRole("list", { name: "Today's Tasks" });
  const pick = await within(list).findByRole("button", { name: "Write report" });
  expect(within(list).queryByRole("button", { name: "Later thing" })).not.toBeInTheDocument();
  expect(pick).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(pick);
  expect(pick).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Linked: Write report" })).toBeInTheDocument();
  expect(
    api.requests.some(
      (r) => r.method === "GET" && r.url.startsWith("/api/v1/tasks?view=today&today=2026-07-03"),
    ),
  ).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  await vi.advanceTimersByTimeAsync(60_000);
  fireEvent.click(screen.getByRole("button", { name: "Finish" }));
  await vi.waitFor(() =>
    expect(
      api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/focus-sessions")?.body,
    ).toMatchObject({
      task_id: api.tasks[0]!.id,
    }),
  );
});

it("the headline's popover links a Habit or clears the link", async () => {
  installFakeApi({
    tasks: [fakeTask("Write report", { due_date: "2026-07-03T00:00:00Z", is_all_day: true })],
    habits: [fakeHabit("Read")],
  });
  window.history.replaceState(null, "", "/focus");
  render(<App />);
  const list = await screen.findByRole("list", { name: "Today's Tasks" });
  fireEvent.click(await within(list).findByRole("button", { name: "Write report" }));
  fireEvent.click(screen.getByRole("button", { name: "Linked: Write report" }));
  const select = screen.getByRole("combobox", { name: "Link" });
  await within(select).findByRole("option", { name: "Read" });
  fireEvent.change(select, {
    target: {
      value: (within(select).getByRole("option", { name: "Read" }) as HTMLOptionElement).value,
    },
  });
  expect(screen.getByRole("button", { name: "Linked: Read" })).toBeInTheDocument();
  expect(within(list).getByRole("button", { name: "Write report" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  fireEvent.click(screen.getByRole("button", { name: "Clear link" }));
  expect(screen.getByRole("button", { name: "Link Task or Habit" })).toBeInTheDocument();
});

it("shows today's and this week's totals and a seven-day strip with today marked", async () => {
  const api = installFakeApi({
    focusSessions: [
      session("2026-07-03", 30),
      session("2026-07-03", 15),
      session("2026-07-01", 60),
      session("2026-06-28", 20), // Sunday: in the strip, not this week
    ],
  });
  window.history.replaceState(null, "", "/focus");
  render(<App />);
  const totals = await screen.findByRole("region", { name: "Focus totals" });
  expect(await within(totals).findByText("45 min")).toBeInTheDocument();
  expect(within(totals).getByText("1 h 45 min")).toBeInTheDocument();
  const strip = within(totals).getByRole("list", { name: "Last 7 days" });
  const days = within(strip).getAllByRole("listitem");
  expect(days.map((d) => d.getAttribute("aria-label"))).toEqual([
    "Jun 27: 0 min",
    "Jun 28: 20 min",
    "Jun 29: 0 min",
    "Jun 30: 0 min",
    "Jul 1: 60 min",
    "Jul 2: 0 min",
    "Jul 3: 45 min",
  ]);
  expect(days[6]).toHaveAttribute("aria-current", "date");
  expect(
    api.requests.some(
      (r) =>
        r.method === "GET" &&
        r.url.startsWith("/api/v1/focus-stats?start=2026-06-27&end=2026-07-03"),
    ),
  ).toBe(true);
  // Full statistics stay one click away.
  fireEvent.click(screen.getByRole("link", { name: "Statistics" }));
  expect(await screen.findByRole("button", { name: /Back to timer/ })).toBeInTheDocument();
});
