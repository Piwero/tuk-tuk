import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeTask, installFakeApi } from "./test/fakeApi";
import { fakeDataTransfer } from "./test/dnd";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 3, 12));
});
afterEach(() => vi.useRealTimers());

async function openToday(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "Today" }));
  await screen.findByRole("heading", { name: "Today" });
}

it("groups Today by due day and time, counts each section and orders Schedule by start", async () => {
  installFakeApi({
    tasks: [
      fakeTask("Late", { due_date: "2026-07-02T00:00:00Z", is_all_day: true }),
      fakeTask("Afternoon", {
        start_date: "2026-07-03T14:00:00Z",
        due_date: "2026-07-03T15:00:00Z",
        sort_order: 0,
      }),
      fakeTask("Morning", {
        start_date: "2026-07-03T09:00:00Z",
        due_date: "2026-07-03T10:30:00Z",
        sort_order: 100,
      }),
      fakeTask("Flexible", { due_date: "2026-07-03T00:00:00Z", is_all_day: true }),
    ],
  });
  render(<App />);
  await openToday();
  expect(await screen.findByRole("heading", { name: "Overdue 1" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Schedule 2" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Anytime 1" })).toBeInTheDocument();
  expect(
    within(screen.getByRole("list", { name: "Tasks in Overdue" })).getByRole("button", {
      name: "Open details for Late",
    }),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole("list", { name: "Tasks in Anytime" })).getByRole("button", {
      name: "Open details for Flexible",
    }),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole("list", { name: "Tasks in Schedule" }))
      .getAllByRole("button", { name: /Open details/ })
      .map((el) => el.textContent),
  ).toEqual(["Morning", "Afternoon"]);
  expect(
    screen.queryByRole("heading", { name: /Tasks in Schedule|Tasks in Overdue/ }),
  ).not.toBeInTheDocument();
});

it("omits empty sections", async () => {
  installFakeApi({
    tasks: [fakeTask("Flexible", { due_date: "2026-07-03T00:00:00Z", is_all_day: true })],
  });
  render(<App />);
  await openToday();
  expect(await screen.findByRole("heading", { name: "Anytime 1" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: /Overdue/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: /Schedule/ })).not.toBeInTheDocument();
});

it("shows weekday, open count and timed planned time", async () => {
  installFakeApi({
    tasks: [
      fakeTask("Meeting", { start_date: "2026-07-03T09:00:00Z", due_date: "2026-07-03T10:30:00Z" }),
      fakeTask("Review", { start_date: "2026-07-03T11:00:00Z", due_date: "2026-07-03T11:45:00Z" }),
      fakeTask("Flexible", { due_date: "2026-07-03T00:00:00Z", is_all_day: true }),
    ],
  });
  render(<App />);
  await openToday();
  expect(await screen.findByText("Friday · 3 open Tasks · 2h 15m planned")).toBeInTheDocument();
});

it("shows Schedule start times and durations", async () => {
  installFakeApi({
    tasks: [
      fakeTask("Deep work", {
        start_date: "2026-07-03T09:00:00Z",
        due_date: "2026-07-03T10:30:00Z",
      }),
    ],
  });
  render(<App />);
  await openToday();
  expect(await screen.findByLabelText("Starts at 09:00")).toHaveTextContent("09:00");
  expect(screen.getByLabelText("1h 30m planned")).toHaveTextContent("1h 30m");
});

it("replaces Today sections when Group by is not None", async () => {
  installFakeApi({
    tasks: [
      fakeTask("High", { due_date: "2026-07-03T00:00:00Z", is_all_day: true, priority: "high" }),
      fakeTask("Low", { due_date: "2026-07-03T00:00:00Z", is_all_day: true, priority: "low" }),
    ],
  });
  render(<App />);
  await openToday();
  expect(await screen.findByRole("heading", { name: "Anytime 2" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^View/ }));
  fireEvent.change(screen.getByRole("combobox", { name: "Group by" }), {
    target: { value: "priority" },
  });
  expect(await screen.findByRole("heading", { name: "High" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Low" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: /Anytime/ })).not.toBeInTheDocument();
});

it("keeps the undo toast when completing from Today", async () => {
  const api = installFakeApi({
    tasks: [fakeTask("Flexible", { due_date: "2026-07-03T00:00:00Z", is_all_day: true })],
  });
  render(<App />);
  await openToday();
  fireEvent.click(await screen.findByRole("checkbox", { name: "Complete Flexible" }));
  expect(await screen.findByRole("button", { name: "Undo" })).toBeInTheDocument();
  expect(api.requests.some((r) => r.method === "PATCH" && r.url.endsWith("/tasks/1"))).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(await screen.findByRole("heading", { name: "Anytime 1" })).toBeInTheDocument();
});

it("drags to reorder within an Anytime section in Custom sort", async () => {
  const first = fakeTask("First", {
    due_date: "2026-07-03T00:00:00Z",
    is_all_day: true,
    sort_order: 0,
  });
  const second = fakeTask("Second", {
    due_date: "2026-07-03T00:00:00Z",
    is_all_day: true,
    sort_order: 100,
  });
  const api = installFakeApi({ tasks: [first, second] });
  render(<App />);
  await openToday();
  const list = await screen.findByRole("list", { name: "Tasks in Anytime" });
  const dataTransfer = fakeDataTransfer();
  fireEvent.dragStart(
    within(list).getByRole("button", { name: "Open details for Second" }).closest("li")!,
    { dataTransfer },
  );
  fireEvent.drop(
    within(list).getByRole("button", { name: "Open details for First" }).closest("li")!,
    { dataTransfer },
  );
  expect(
    api.requests.some(
      (r) =>
        r.method === "PATCH" &&
        r.url === `/api/v1/tasks/${second.id}` &&
        typeof (r.body as { sort_order?: unknown }).sort_order === "number",
    ),
  ).toBe(true);
  expect(await within(list).findAllByRole("button", { name: /Open details/ })).toHaveLength(2);
  expect(
    within(list)
      .getAllByRole("button", { name: /Open details/ })
      .map((el) => el.textContent),
  ).toEqual(["Second", "First"]);
});
