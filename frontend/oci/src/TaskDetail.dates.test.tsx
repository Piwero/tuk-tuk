import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { browserTimeZone } from "./dates";
import { fakeTask, installFakeApi, type RecordedRequest } from "./test/fakeApi";

// All tests pin the clock to Friday 2026-07-03, local noon, so quick picks
// and overdue math are deterministic in any timezone.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

async function openDetail(taskTitle: string): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("button", { name: `Open details for ${taskTitle}` }));
  return await screen.findByRole("complementary", { name: "Task details" });
}

function lastTaskPatch(requests: RecordedRequest[], taskId: number): unknown {
  const patches = requests.filter(
    (r) => r.method === "PATCH" && r.url === `/api/v1/tasks/${taskId}`,
  );
  return patches.at(-1)?.body;
}

describe("Task scheduling from the detail panel", () => {
  it("quick pick Today sets an all-day due date today with the browser timezone", async () => {
    const chore = fakeTask("Water plants");
    const api = installFakeApi({ tasks: [chore] });
    render(<App />);

    const panel = await openDetail("Water plants");
    fireEvent.click(within(panel).getByRole("button", { name: "Today" }));

    await waitFor(() =>
      expect(lastTaskPatch(api.requests, chore.id)).toEqual({
        start_date: null,
        due_date: "2026-07-03T00:00:00Z",
        is_all_day: true,
        time_zone: browserTimeZone(),
      }),
    );
    expect(await within(panel).findByText("Jul 3")).toBeInTheDocument();
  });

  it("quick pick Tomorrow sets tomorrow; Next Week sets next Monday", async () => {
    const chore = fakeTask("Water plants");
    const api = installFakeApi({ tasks: [chore] });
    render(<App />);

    const panel = await openDetail("Water plants");
    fireEvent.click(within(panel).getByRole("button", { name: "Tomorrow" }));
    await waitFor(() =>
      expect(lastTaskPatch(api.requests, chore.id)).toMatchObject({
        due_date: "2026-07-04T00:00:00Z",
      }),
    );

    fireEvent.click(within(panel).getByRole("button", { name: "Next Week" }));
    await waitFor(() =>
      expect(lastTaskPatch(api.requests, chore.id)).toMatchObject({
        due_date: "2026-07-06T00:00:00Z",
      }),
    );
  });

  it("schedules a timed start+due duration within a day from the custom editor", async () => {
    const meeting = fakeTask("Design review");
    const api = installFakeApi({ tasks: [meeting] });
    render(<App />);

    const panel = await openDetail("Design review");
    fireEvent.click(within(panel).getByRole("button", { name: "Custom date" }));
    fireEvent.change(within(panel).getByLabelText("Day"), { target: { value: "2026-07-10" } });
    fireEvent.change(within(panel).getByLabelText("Start time"), { target: { value: "14:00" } });
    fireEvent.change(within(panel).getByLabelText("Due time"), { target: { value: "15:30" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Save date" }));

    await waitFor(() =>
      expect(lastTaskPatch(api.requests, meeting.id)).toEqual({
        start_date: new Date(2026, 6, 10, 14, 0).toISOString(),
        due_date: new Date(2026, 6, 10, 15, 30).toISOString(),
        is_all_day: false,
        time_zone: browserTimeZone(),
      }),
    );
  });

  it("saves a custom date without a time as an all-day date", async () => {
    const errand = fakeTask("Pick up parcel");
    const api = installFakeApi({ tasks: [errand] });
    render(<App />);

    const panel = await openDetail("Pick up parcel");
    fireEvent.click(within(panel).getByRole("button", { name: "Custom date" }));
    fireEvent.change(within(panel).getByLabelText("Day"), { target: { value: "2026-07-10" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Save date" }));

    await waitFor(() =>
      expect(lastTaskPatch(api.requests, errand.id)).toEqual({
        start_date: null,
        due_date: "2026-07-10T00:00:00Z",
        is_all_day: true,
        time_zone: browserTimeZone(),
      }),
    );
  });

  it("schedules an all-day span across multiple days", async () => {
    const trip = fakeTask("Conference");
    const api = installFakeApi({ tasks: [trip] });
    render(<App />);

    const panel = await openDetail("Conference");
    fireEvent.click(within(panel).getByRole("button", { name: "Custom date" }));
    fireEvent.click(within(panel).getByRole("checkbox", { name: "All day" }));
    fireEvent.change(within(panel).getByLabelText("Start day"), {
      target: { value: "2026-07-06" },
    });
    fireEvent.change(within(panel).getByLabelText("Due day"), { target: { value: "2026-07-08" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Save date" }));

    await waitFor(() =>
      expect(lastTaskPatch(api.requests, trip.id)).toEqual({
        start_date: "2026-07-06T00:00:00Z",
        due_date: "2026-07-08T00:00:00Z",
        is_all_day: true,
        time_zone: browserTimeZone(),
      }),
    );
    expect(await within(panel).findByText("Jul 6 – Jul 8")).toBeInTheDocument();
  });

  it("edits an existing schedule from the custom editor, prefilled", async () => {
    const trip = fakeTask("Conference", {
      start_date: "2026-07-06T00:00:00Z",
      due_date: "2026-07-08T00:00:00Z",
      is_all_day: true,
      time_zone: browserTimeZone(),
    });
    const api = installFakeApi({ tasks: [trip] });
    render(<App />);

    const panel = await openDetail("Conference");
    fireEvent.click(within(panel).getByRole("button", { name: "Custom date" }));
    expect(within(panel).getByRole("checkbox", { name: "All day" })).toBeChecked();
    expect(within(panel).getByLabelText("Start day")).toHaveValue("2026-07-06");
    expect(within(panel).getByLabelText("Due day")).toHaveValue("2026-07-08");

    fireEvent.change(within(panel).getByLabelText("Due day"), { target: { value: "2026-07-09" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Save date" }));

    await waitFor(() =>
      expect(lastTaskPatch(api.requests, trip.id)).toMatchObject({
        due_date: "2026-07-09T00:00:00Z",
      }),
    );
  });

  it("clears the whole schedule with one click", async () => {
    const trip = fakeTask("Conference", {
      start_date: "2026-07-06T00:00:00Z",
      due_date: "2026-07-08T00:00:00Z",
      is_all_day: true,
      time_zone: "Europe/Amsterdam",
    });
    const api = installFakeApi({ tasks: [trip] });
    render(<App />);

    const panel = await openDetail("Conference");
    fireEvent.click(within(panel).getByRole("button", { name: "Clear date" }));

    await waitFor(() =>
      expect(lastTaskPatch(api.requests, trip.id)).toEqual({
        start_date: null,
        due_date: null,
        is_all_day: false,
        time_zone: null,
      }),
    );
    expect(within(panel).queryByRole("button", { name: "Clear date" })).not.toBeInTheDocument();
  });
});
