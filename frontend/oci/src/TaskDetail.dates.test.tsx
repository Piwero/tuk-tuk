import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { browserTimeZone } from "./dates";
import { fakeTask, installFakeApi, type RecordedRequest } from "./test/fakeApi";

// Date row (#453). Clock pinned to Friday 2026-07-03, local noon (TZ=UTC).
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

async function openDetail(taskTitle: string): Promise<HTMLElement> {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  await user.click(await screen.findByRole("button", { name: `Open details for ${taskTitle}` }));
  return await screen.findByRole("complementary", { name: "Task details" });
}

function patches(requests: RecordedRequest[], taskId: number): unknown[] {
  return requests
    .filter((r) => r.method === "PATCH" && r.url === `/api/v1/tasks/${taskId}`)
    .map((r) => r.body);
}

async function openDateRow(panel: HTMLElement, user: ReturnType<typeof userEvent.setup>) {
  await user.click(within(panel).getByRole("button", { name: /^Due date / }));
  return within(panel).getByRole("dialog", { name: "Due date" });
}

describe("Task detail Date row", () => {
  it.each([
    [
      "a timed range today",
      { start_date: "2026-07-03T10:00:00Z", due_date: "2026-07-03T11:30:00Z", is_all_day: false },
      "Today, 10:00–11:30",
    ],
    ["all-day tomorrow", { due_date: "2026-07-04T00:00:00Z", is_all_day: true }, "Tomorrow"],
    [
      "timed yesterday",
      { due_date: "2026-07-02T09:00:00Z", is_all_day: false },
      "Yesterday, 09:00",
    ],
    ["later this week", { due_date: "2026-07-07T00:00:00Z", is_all_day: true }, "Tue"],
    ["further out", { due_date: "2026-07-20T00:00:00Z", is_all_day: true }, "Jul 20"],
    ["unscheduled", {}, "No date"],
  ])("reads %s relatively", async (_name, schedule, label) => {
    installFakeApi({ tasks: [fakeTask("Plan", { time_zone: "UTC", ...schedule })] });
    render(<App />);

    const panel = await openDetail("Plan");
    expect(within(panel).getByRole("button", { name: `Due date ${label}` })).toBeInTheDocument();
  });

  it("reads quietly when unset", async () => {
    installFakeApi({ tasks: [fakeTask("Someday")] });
    render(<App />);

    const panel = await openDetail("Someday");
    expect(within(panel).getByRole("button", { name: "Due date No date" })).toHaveClass("is-quiet");
  });

  it("Today sets an all-day date and the row reads Today", async () => {
    const chore = fakeTask("Water plants");
    const api = installFakeApi({ tasks: [chore] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);

    const panel = await openDetail("Water plants");
    const dialog = await openDateRow(panel, user);
    await user.click(within(dialog).getByRole("button", { name: "Today" }));

    await waitFor(() =>
      expect(patches(api.requests, chore.id)).toEqual([
        {
          start_date: null,
          due_date: "2026-07-03T00:00:00Z",
          is_all_day: true,
          time_zone: browserTimeZone(),
        },
      ]),
    );
    expect(
      await within(panel).findByRole("button", { name: "Due date Today" }),
    ).toBeInTheDocument();
  });

  it("Tomorrow and Next week pick tomorrow and next Monday", async () => {
    const chore = fakeTask("Water plants");
    const api = installFakeApi({ tasks: [chore] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);

    const panel = await openDetail("Water plants");
    await user.click(
      within(await openDateRow(panel, user)).getByRole("button", { name: "Tomorrow" }),
    );
    await within(panel).findByRole("button", { name: "Due date Tomorrow" });
    await user.click(
      within(await openDateRow(panel, user)).getByRole("button", { name: "Next week" }),
    );

    await waitFor(() =>
      expect(patches(api.requests, chore.id)).toMatchObject([
        { due_date: "2026-07-04T00:00:00Z" },
        { due_date: "2026-07-06T00:00:00Z" },
      ]),
    );
  });

  it("picks a custom day and time range from the calendar", async () => {
    const meeting = fakeTask("Design review");
    const api = installFakeApi({ tasks: [meeting] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);

    const panel = await openDetail("Design review");
    const dialog = await openDateRow(panel, user);
    await user.click(within(dialog).getByRole("button", { name: "Friday, July 10, 2026" }));
    await waitFor(() =>
      expect(patches(api.requests, meeting.id)).toMatchObject([
        { due_date: "2026-07-10T00:00:00Z", is_all_day: true },
      ]),
    );

    const again = await openDateRow(panel, user);
    // The date popover takes plain values only: no Quick-Add sigil input.
    expect(within(again).queryByRole("textbox")).not.toBeInTheDocument();
    await user.type(within(again).getByLabelText("Start time"), "14:00");
    await user.type(within(again).getByLabelText("End time"), "15:30");

    await waitFor(() =>
      expect(patches(api.requests, meeting.id).at(-1)).toEqual({
        start_date: new Date(2026, 6, 10, 14, 0).toISOString(),
        due_date: new Date(2026, 6, 10, 15, 30).toISOString(),
        is_all_day: false,
        time_zone: browserTimeZone(),
      }),
    );
    expect(
      await within(panel).findByRole("button", { name: "Due date Jul 10, 14:00–15:30" }),
    ).toBeInTheDocument();
  });

  it("keeps a timed Task's times when moving it to another day", async () => {
    const meeting = fakeTask("Stand-up", {
      start_date: "2026-07-03T10:00:00Z",
      due_date: "2026-07-03T11:30:00Z",
      is_all_day: false,
      time_zone: "UTC",
    });
    const api = installFakeApi({ tasks: [meeting] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);

    const panel = await openDetail("Stand-up");
    await user.click(
      within(await openDateRow(panel, user)).getByRole("button", { name: "Tomorrow" }),
    );

    expect(
      await within(panel).findByRole("button", { name: "Due date Tomorrow, 10:00–11:30" }),
    ).toBeInTheDocument();
    expect(patches(api.requests, meeting.id)).toMatchObject([
      { start_date: "2026-07-04T10:00:00.000Z", due_date: "2026-07-04T11:30:00.000Z" },
    ]);
  });

  it("Clear removes the whole schedule", async () => {
    const trip = fakeTask("Conference", {
      start_date: "2026-07-06T00:00:00Z",
      due_date: "2026-07-08T00:00:00Z",
      is_all_day: true,
      time_zone: "Europe/Amsterdam",
    });
    const api = installFakeApi({ tasks: [trip] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);

    const panel = await openDetail("Conference");
    expect(
      within(panel).getByRole("button", { name: "Due date Jul 6 – Jul 8" }),
    ).toBeInTheDocument();
    await user.click(within(await openDateRow(panel, user)).getByRole("button", { name: "Clear" }));

    await waitFor(() =>
      expect(patches(api.requests, trip.id)).toEqual([
        { start_date: null, due_date: null, is_all_day: false, time_zone: null },
      ]),
    );
    expect(
      await within(panel).findByRole("button", { name: "Due date No date" }),
    ).toBeInTheDocument();
  });
});
