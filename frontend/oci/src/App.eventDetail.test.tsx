import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { openCalendar, pinCalendarClock } from "./test/calendar";
import { fakeEvent, fakeTask, installFakeApi } from "./test/fakeApi";

pinCalendarClock();

describe("Event detail popover (issue #110)", () => {
  it("opens a read-only dialog naming the Event on click, and issues no write", async () => {
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
    fireEvent.click(await screen.findByText("Standup"));

    const dialog = await screen.findByRole("dialog", { name: "Standup" });
    expect(dialog).toBeInTheDocument();
    expect(api.requests.some((r) => r.method !== "GET")).toBe(false);
  });

  it("shows the Event's start and end times", async () => {
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
    fireEvent.click(await screen.findByText("Standup"));

    const dialog = await screen.findByRole("dialog", { name: "Standup" });
    expect(within(dialog).getByText(/09:00/)).toBeInTheDocument();
    expect(within(dialog).getByText(/09:30/)).toBeInTheDocument();
  });

  it("shows the location when the Event has one", async () => {
    installFakeApi({
      googleConfigured: true,
      events: [fakeEvent("Standup", { location: "Room 4B" })],
    });
    render(<App />);

    await openCalendar();
    fireEvent.click(await screen.findByText("Standup"));

    const dialog = await screen.findByRole("dialog", { name: "Standup" });
    expect(within(dialog).getByText("Room 4B")).toBeInTheDocument();
  });

  it("shows attendees and the organiser when present", async () => {
    installFakeApi({
      googleConfigured: true,
      events: [
        fakeEvent("Planning", {
          organizer: { email: "boss@example.com", display_name: "Boss" },
          attendees: [
            { email: "me@example.com", display_name: "Me" },
            { email: "other@example.com", display_name: null },
          ],
        }),
      ],
    });
    render(<App />);

    await openCalendar();
    fireEvent.click(await screen.findByText("Planning"));

    const dialog = await screen.findByRole("dialog", { name: "Planning" });
    expect(within(dialog).getByText(/Boss/)).toBeInTheDocument();
    expect(within(dialog).getByText(/organiser/)).toBeInTheDocument();
    expect(within(dialog).getByText("Me")).toBeInTheDocument();
    expect(within(dialog).getByText("other@example.com")).toBeInTheDocument();
  });

  it("shows the description when the Event has one", async () => {
    installFakeApi({
      googleConfigured: true,
      events: [fakeEvent("Standup", { description: "Daily sync notes" })],
    });
    render(<App />);

    await openCalendar();
    fireEvent.click(await screen.findByText("Standup"));

    const dialog = await screen.findByRole("dialog", { name: "Standup" });
    expect(within(dialog).getByText("Daily sync notes")).toBeInTheDocument();
  });

  it("names the account and calendar the Event came from", async () => {
    installFakeApi({
      googleConfigured: true,
      events: [
        fakeEvent("Standup", {
          account_email: "me@example.com",
          calendar_summary: "Personal",
        }),
      ],
    });
    render(<App />);

    await openCalendar();
    fireEvent.click(await screen.findByText("Standup"));

    const dialog = await screen.findByRole("dialog", { name: "Standup" });
    expect(within(dialog).getByText(/Personal/)).toBeInTheDocument();
    expect(within(dialog).getByText(/me@example\.com/)).toBeInTheDocument();
  });

  it("offers a link that opens the Event in Google Calendar", async () => {
    installFakeApi({
      googleConfigured: true,
      events: [
        fakeEvent("Standup", { html_link: "https://calendar.google.com/calendar/event?eid=xyz" }),
      ],
    });
    render(<App />);

    await openCalendar();
    fireEvent.click(await screen.findByText("Standup"));

    const dialog = await screen.findByRole("dialog", { name: "Standup" });
    const link = within(dialog).getByRole("link", { name: /Google Calendar/ });
    expect(link).toHaveAttribute("href", "https://calendar.google.com/calendar/event?eid=xyz");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("dismisses without side effects", async () => {
    const api = installFakeApi({
      googleConfigured: true,
      events: [fakeEvent("Standup")],
    });
    render(<App />);

    await openCalendar();
    fireEvent.click(await screen.findByText("Standup"));
    await screen.findByRole("dialog", { name: "Standup" });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog", { name: "Standup" })).toBeNull();
    expect(api.requests.some((r) => r.method !== "GET")).toBe(false);
  });

  it("renders a sensible popover for an Event with no location, attendees or description", async () => {
    installFakeApi({
      googleConfigured: true,
      events: [fakeEvent("Bare event")],
    });
    render(<App />);

    await openCalendar();
    fireEvent.click(await screen.findByText("Bare event"));

    const dialog = await screen.findByRole("dialog", { name: "Bare event" });
    expect(dialog).toBeInTheDocument();
  });

  it("clicking a Task continues to open the Task detail panel, not the Event popover", async () => {
    installFakeApi({
      googleConfigured: true,
      tasks: [
        fakeTask("A task", {
          start_date: "2026-07-06T09:00:00Z",
          due_date: "2026-07-06T09:30:00Z",
          time_zone: "UTC",
        }),
      ],
    });
    render(<App />);

    await openCalendar();
    fireEvent.click(await screen.findByText("A task"));

    expect(await screen.findByLabelText("Task details")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "A task" })).toBeNull();
  });
});

describe("Convert an Event to a Task (issue #111)", () => {
  it("offers a Convert to task action", async () => {
    installFakeApi({ googleConfigured: true, events: [fakeEvent("Standup")] });
    render(<App />);

    await openCalendar();
    fireEvent.click(await screen.findByText("Standup"));

    const dialog = await screen.findByRole("dialog", { name: "Standup" });
    expect(within(dialog).getByRole("button", { name: "Convert to task" })).toBeInTheDocument();
  });

  it("shows a preview before confirming, and issues no write until confirmed", async () => {
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
    fireEvent.click(await screen.findByText("Standup"));
    const dialog = await screen.findByRole("dialog", { name: "Standup" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Convert to task" }));

    expect(within(dialog).getByText(/09:00/)).toBeInTheDocument();
    expect(within(dialog).getByText(/09:30/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect(api.requests.some((r) => r.method !== "GET")).toBe(false);
  });

  it("cancelling the preview leaves the Event untouched", async () => {
    const api = installFakeApi({
      googleConfigured: true,
      events: [fakeEvent("Standup")],
    });
    render(<App />);

    await openCalendar();
    fireEvent.click(await screen.findByText("Standup"));
    const dialog = await screen.findByRole("dialog", { name: "Standup" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Convert to task" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(within(dialog).getByRole("button", { name: "Convert to task" })).toBeInTheDocument();
    expect(api.requests.some((r) => r.method !== "GET")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByText("Standup")).toBeInTheDocument();
  });

  it("confirming creates the Task, closes the popover, and removes the Event from the Calendar", async () => {
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
    fireEvent.click(await screen.findByText("Standup"));
    const dialog = await screen.findByRole("dialog", { name: "Standup" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Convert to task" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));

    await screen.findByText("Standup"); // the Task, once the Event it replaces is gone
    expect(screen.queryByRole("dialog", { name: "Standup" })).toBeNull();
    const created = api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/tasks")
      ?.body as { title: string; start_date: string; due_date: string };
    expect(created.title).toBe("Standup");
    expect(created.start_date).toBe("2026-07-06T09:00:00Z");
    expect(created.due_date).toBe("2026-07-06T09:30:00Z");
  });

  it("carries the Event's provenance so the Task can hide it, and lands in the Inbox at default priority", async () => {
    const api = installFakeApi({
      googleConfigured: true,
      events: [fakeEvent("Standup", { calendar_id: 3, google_event_id: "evt-42" })],
    });
    render(<App />);

    await openCalendar();
    fireEvent.click(await screen.findByText("Standup"));
    const dialog = await screen.findByRole("dialog", { name: "Standup" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Convert to task" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await screen.findByText("Standup");

    const created = api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/tasks")
      ?.body as {
      source_google_calendar_id: number;
      source_google_event_id: string;
      priority?: string;
      list_id?: number;
    };
    expect(created.source_google_calendar_id).toBe(3);
    expect(created.source_google_event_id).toBe("evt-42");
    expect(created.priority).toBeUndefined();
    expect(created.list_id).toBeUndefined();
  });

  it("carries the Event's description and location into the Task, with a link back", async () => {
    const api = installFakeApi({
      googleConfigured: true,
      events: [fakeEvent("Standup", { description: "Daily sync", location: "Room 4B" })],
    });
    render(<App />);

    await openCalendar();
    fireEvent.click(await screen.findByText("Standup"));
    const dialog = await screen.findByRole("dialog", { name: "Standup" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Convert to task" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await screen.findByText("Standup");

    const created = api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/tasks")
      ?.body as { description: string };
    expect(created.description).toContain("Daily sync");
    expect(created.description).toContain("Room 4B");
    expect(created.description).toContain("https://calendar.google.com/calendar/event?eid=fake");
  });

  it("converts an all-day Event into an all-day Task covering the same days", async () => {
    const api = installFakeApi({
      googleConfigured: true,
      events: [
        fakeEvent("Offsite", {
          is_all_day: true,
          start_date: "2026-07-10T00:00:00Z",
          due_date: "2026-07-12T00:00:00Z",
        }),
      ],
    });
    render(<App />);

    await openCalendar();
    fireEvent.click((await screen.findAllByText("Offsite"))[0] as HTMLElement);
    const dialog = await screen.findByRole("dialog", { name: "Offsite" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Convert to task" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await screen.findAllByText("Offsite");

    const created = api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/tasks")
      ?.body as { is_all_day: boolean; start_date: string; due_date: string };
    expect(created.is_all_day).toBe(true);
    expect(created.start_date).toBe("2026-07-10T00:00:00Z");
    expect(created.due_date).toBe("2026-07-12T00:00:00Z");
  });

  it("shows a midnight-crossing Event's clamp before confirming, and preserves its true end", async () => {
    const api = installFakeApi({
      googleConfigured: true,
      events: [
        fakeEvent("Red-eye flight", {
          start_date: "2026-07-06T23:00:00Z",
          due_date: "2026-07-07T00:45:00Z",
        }),
      ],
    });
    render(<App />);

    await openCalendar();
    fireEvent.click((await screen.findAllByText("Red-eye flight"))[0] as HTMLElement);
    const dialog = await screen.findByRole("dialog", { name: "Red-eye flight" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Convert to task" }));

    expect(within(dialog).getAllByText(/Originally ends/).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(/00:45/).length).toBeGreaterThan(0);

    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await screen.findByText("Red-eye flight");

    const created = api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/tasks")
      ?.body as { due_date: string; description: string };
    expect(created.due_date).toBe("2026-07-06T23:59:00.000Z");
    expect(created.description).toContain("Originally ends");
  });
});
