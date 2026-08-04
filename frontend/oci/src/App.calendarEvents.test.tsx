import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { openCalendar, openWeek, pinCalendarClock } from "./test/calendar";
import { fakeEvent, fakeTask, installFakeApi } from "./test/fakeApi";

pinCalendarClock();

describe("Events in the Calendar view (issue #107)", () => {
  it("fetches and renders a timed Event alongside Tasks in Month view", async () => {
    const api = installFakeApi({
      googleConfigured: true,
      events: [
        fakeEvent("Standup", {
          start_date: "2026-07-06T09:00:00Z",
          due_date: "2026-07-06T09:30:00Z",
        }),
      ],
    });
    render(<App />);

    await openCalendar();

    await waitFor(() =>
      expect(
        api.requests.some(
          (r) =>
            r.method === "GET" &&
            r.url === "/api/v1/events?range_start=2026-06-29&range_end=2026-08-02",
        ),
      ).toBe(true),
    );
    const day = screen.getByLabelText("2026-07-06");
    const entry = await within(day).findByText("Standup");
    expect(entry.closest("[data-kind]")).toHaveAttribute("data-kind", "event");
  });

  it("renders an all-day Event as a banner spanning exactly its days", async () => {
    installFakeApi({
      googleConfigured: true,
      events: [
        fakeEvent("Trip", {
          start_date: "2026-07-10T00:00:00Z",
          due_date: "2026-07-12T00:00:00Z",
          is_all_day: true,
        }),
      ],
    });
    render(<App />);

    await openCalendar();

    const banners = await screen.findAllByText("Trip");
    expect(banners).toHaveLength(3);
    for (const day of ["2026-07-10", "2026-07-11", "2026-07-12"]) {
      expect(within(screen.getByLabelText(day)).getByText("Trip")).toBeInTheDocument();
    }
    expect(within(screen.getByLabelText("2026-07-09")).queryByText("Trip")).toBeNull();
    expect(within(screen.getByLabelText("2026-07-13")).queryByText("Trip")).toBeNull();
  });

  it("is not draggable and opens no task detail on click", async () => {
    installFakeApi({
      googleConfigured: true,
      events: [
        fakeEvent("Standup", {
          start_date: "2026-07-06T09:00:00Z",
          due_date: "2026-07-06T09:30:00Z",
        }),
      ],
    });
    render(<App />);

    await openCalendar();

    const entry = await screen.findByText("Standup");
    const block = entry.closest("[data-kind]") as HTMLElement;
    expect(block).not.toHaveAttribute("draggable", "true");
    fireEvent.click(entry);
    expect(screen.queryByLabelText("Task details")).toBeNull();
  });

  it("never appears in the unscheduled panel", async () => {
    installFakeApi({
      googleConfigured: true,
      events: [
        fakeEvent("Standup", {
          start_date: "2026-07-06T09:00:00Z",
          due_date: "2026-07-06T09:30:00Z",
        }),
      ],
    });
    render(<App />);

    await openCalendar();
    await screen.findByText("Standup");

    expect(
      within(screen.getByRole("complementary", { name: "Unscheduled" })).queryByText("Standup"),
    ).toBeNull();
  });

  it("sorts an Event before a Task at the same start time", async () => {
    installFakeApi({
      googleConfigured: true,
      tasks: [
        fakeTask("A task", {
          start_date: "2026-07-06T09:00:00Z",
          due_date: "2026-07-06T09:30:00Z",
          time_zone: "UTC",
        }),
      ],
      events: [
        fakeEvent("An event", {
          start_date: "2026-07-06T09:00:00Z",
          due_date: "2026-07-06T09:30:00Z",
        }),
      ],
    });
    render(<App />);

    await openCalendar();

    const day = screen.getByLabelText("2026-07-06");
    await within(day).findByText(/An event/);
    const entries = within(day).getAllByText(/An event|A task/);
    expect(entries[0]).toHaveTextContent("An event");
    expect(entries[1]).toHaveTextContent("A task");
  });

  it("renders a timed Event as a resize-handle-free block in Week view", async () => {
    installFakeApi({
      googleConfigured: true,
      events: [
        fakeEvent("Standup", {
          start_date: "2026-07-06T09:00:00Z",
          due_date: "2026-07-06T09:30:00Z",
        }),
      ],
    });
    render(<App />);

    await openWeek();

    const block = (await screen.findByText("Standup")).closest(".time-block") as HTMLElement;
    expect(block).toHaveAttribute("data-kind", "event");
    expect(within(block).queryByRole("button", { name: /Resize/ })).toBeNull();
  });
});
