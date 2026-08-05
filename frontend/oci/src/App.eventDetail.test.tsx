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
