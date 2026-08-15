import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { openCalendar, openDay, openWeek, pinCalendarClock } from "./test/calendar";
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
    // Wed Jul 1: inside the Monday-aligned week (Jun 29 – Jul 5) containing today.
    installFakeApi({
      googleConfigured: true,
      events: [
        fakeEvent("Standup", {
          start_date: "2026-07-01T09:00:00Z",
          due_date: "2026-07-01T09:30:00Z",
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

describe("Midnight-crossing Events (issue #108)", () => {
  it("splits an overnight Event into a segment in each day's column in Week view", async () => {
    installFakeApi({
      googleConfigured: true,
      events: [
        fakeEvent("Flight", {
          start_date: "2026-07-03T23:00:00Z",
          due_date: "2026-07-04T01:00:00Z",
        }),
      ],
    });
    render(<App />);

    await openWeek();

    await screen.findAllByText("Flight");
    const firstColumn = document.querySelector('.day-column[data-day="2026-07-03"]') as HTMLElement;
    const secondColumn = document.querySelector(
      '.day-column[data-day="2026-07-04"]',
    ) as HTMLElement;

    const firstBlock = within(firstColumn).getByText("Flight").closest(".time-block");
    expect(firstBlock).toHaveAttribute("data-start", "23:00");
    expect(firstBlock).toHaveAttribute("data-end", "23:59");
    expect(firstBlock).toHaveAttribute("data-kind", "event");

    const secondBlock = within(secondColumn).getByText("Flight").closest(".time-block");
    expect(secondBlock).toHaveAttribute("data-start", "00:00");
    expect(secondBlock).toHaveAttribute("data-end", "01:00");
    expect(secondBlock).toHaveAttribute("data-kind", "event");
  });

  it("shows only the segment for the viewed day in Day view", async () => {
    installFakeApi({
      googleConfigured: true,
      events: [
        fakeEvent("Flight", {
          start_date: "2026-07-03T23:00:00Z",
          due_date: "2026-07-04T01:00:00Z",
        }),
      ],
    });
    render(<App />);

    await openDay();

    const segments = await screen.findAllByText("Flight");
    expect(segments).toHaveLength(1);
    const block = segments[0]?.closest(".time-block");
    expect(block).toHaveAttribute("data-start", "23:00");
    expect(block).toHaveAttribute("data-end", "23:59");
  });

  it("segments an Event spanning more than two days across every day it touches", async () => {
    installFakeApi({
      googleConfigured: true,
      events: [
        fakeEvent("Conference", {
          start_date: "2026-07-03T23:00:00Z",
          due_date: "2026-07-05T01:00:00Z",
        }),
      ],
    });
    render(<App />);

    await openWeek();

    const segments = await screen.findAllByText("Conference");
    expect(segments).toHaveLength(3);

    const middleColumn = document.querySelector(
      '.day-column[data-day="2026-07-04"]',
    ) as HTMLElement;
    const middleBlock = within(middleColumn).getByText("Conference").closest(".time-block");
    expect(middleBlock).toHaveAttribute("data-start", "00:00");
    expect(middleBlock).toHaveAttribute("data-end", "23:59");
  });
});

describe("Per-account failure handling and Event refresh (issue #109)", () => {
  it("still renders every other account's Events when one account fails", async () => {
    installFakeApi({
      googleConfigured: true,
      events: [
        fakeEvent("Standup", {
          start_date: "2026-07-06T09:00:00Z",
          due_date: "2026-07-06T09:30:00Z",
        }),
      ],
      eventFailures: [
        { account_id: 1, email: "broken@example.com", kind: "transient", message: "server error" },
      ],
    });
    render(<App />);

    await openCalendar();

    expect(await screen.findByText("Standup")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(/broken@example.com/);
  });

  it("names the failed account in the banner", async () => {
    installFakeApi({
      googleConfigured: true,
      eventFailures: [
        { account_id: 1, email: "broken@example.com", kind: "transient", message: "server error" },
      ],
    });
    render(<App />);

    await openCalendar();

    expect(await screen.findByRole("alert")).toHaveTextContent("broken@example.com");
  });

  it("offers Retry (not Reconnect) for a transient failure", async () => {
    installFakeApi({
      googleConfigured: true,
      eventFailures: [
        { account_id: 1, email: "broken@example.com", kind: "transient", message: "server error" },
      ],
    });
    render(<App />);

    await openCalendar();

    await screen.findByRole("alert");
    expect(screen.queryByRole("link", { name: "Reconnect" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh Events" })).toBeInTheDocument();
  });

  it("offers Reconnect for a terminal failure", async () => {
    installFakeApi({
      googleConfigured: true,
      eventFailures: [
        {
          account_id: 1,
          email: "revoked@example.com",
          kind: "terminal",
          message: "invalid_grant",
        },
      ],
    });
    render(<App />);

    await openCalendar();

    const reconnectLink = await screen.findByRole("link", { name: "Reconnect" });
    expect(reconnectLink).toHaveAttribute("href", "/api/v1/google/connect");
  });

  it("refetches Events when the window changes", async () => {
    const api = installFakeApi({ googleConfigured: true });
    render(<App />);

    await openCalendar();
    await waitFor(() =>
      expect(
        api.requests.some(
          (r) => r.method === "GET" && r.url.startsWith("/api/v1/events?range_start=2026-06-29"),
        ),
      ).toBe(true),
    );

    await act(async () => {
      screen.getByRole("button", { name: "Next" }).click();
    });

    await waitFor(() =>
      expect(
        api.requests.some(
          (r) => r.method === "GET" && r.url.startsWith("/api/v1/events?range_start=2026-07-27"),
        ),
      ).toBe(true),
    );
  });

  it("refetches Events when the browser tab regains focus", async () => {
    const api = installFakeApi({ googleConfigured: true });
    render(<App />);

    await openCalendar();
    await waitFor(() =>
      expect(api.requests.filter((r) => r.url.startsWith("/api/v1/events")).length).toBe(1),
    );

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() =>
      expect(api.requests.filter((r) => r.url.startsWith("/api/v1/events")).length).toBe(2),
    );
    const [, secondRequest] = api.requests.filter((r) => r.url.startsWith("/api/v1/events"));
    // Forces past the cache: a focus refetch that's still cache-eligible
    // could serve a stale answer, defeating the point of the refetch.
    expect(secondRequest?.url).toContain("force=true");
  });

  it("forces a fresh fetch when the manual refresh control is used", async () => {
    const api = installFakeApi({ googleConfigured: true });
    render(<App />);

    await openCalendar();
    await waitFor(() =>
      expect(api.requests.some((r) => r.url.startsWith("/api/v1/events"))).toBe(true),
    );

    await act(async () => {
      screen.getByRole("button", { name: "Refresh Events" }).click();
    });

    await waitFor(() =>
      expect(
        api.requests.some(
          (r) =>
            r.method === "GET" &&
            r.url.startsWith("/api/v1/events") &&
            r.url.includes("force=true"),
        ),
      ).toBe(true),
    );
  });
});
