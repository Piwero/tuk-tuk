import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { openCalendar, openDay, openWeek, pinCalendarClock } from "./test/calendar";
import { closestOrThrow, fakeDataTransfer } from "./test/dnd";
import { fakeEvent, fakeList, fakeTask, INBOX, installFakeApi } from "./test/fakeApi";

pinCalendarClock();

describe("Calendar entries coloured by their List (issue #203)", () => {
  it("tints a Task block with its List's colour", async () => {
    installFakeApi({
      lists: [INBOX, fakeList("Work", { id: 5, color: "#4772fa" })],
      tasks: [
        fakeTask("Sync", {
          list_id: 5,
          start_date: "2026-07-03T14:00:00Z",
          due_date: "2026-07-03T15:00:00Z",
          time_zone: "UTC",
        }),
      ],
    });
    render(<App />);
    await openDay();

    const block = closestOrThrow(await screen.findByText("Sync"), ".time-block");
    expect(block).toHaveAttribute("data-list-color", "true");
    expect(block.style.getPropertyValue("--entry-color")).toBe("#4772fa");
  });

  it("renders a Task in a colourless List (the Inbox) with no tint", async () => {
    installFakeApi({
      tasks: [
        fakeTask("Errand", {
          start_date: "2026-07-03T14:00:00Z",
          due_date: "2026-07-03T15:00:00Z",
          time_zone: "UTC",
        }),
      ],
    });
    render(<App />);
    await openDay();

    const block = closestOrThrow(await screen.findByText("Errand"), ".time-block");
    expect(block).not.toHaveAttribute("data-list-color");
    expect(block.style.getPropertyValue("--entry-color")).toBe("");
  });
});

describe("Events on the calendar stay read-only (issue #203)", () => {
  it("exposes no drag or resize affordance on an Event block", async () => {
    installFakeApi({
      events: [
        fakeEvent("Board meeting", {
          start_date: "2026-07-03T14:00:00Z",
          due_date: "2026-07-03T15:00:00Z",
        }),
      ],
    });
    render(<App />);
    await openDay();

    const block = closestOrThrow(await screen.findByText("Board meeting"), ".time-block");
    expect(block).toHaveAttribute("data-kind", "event");
    expect(block).not.toHaveAttribute("draggable", "true");
    expect(within(block).queryByRole("button", { name: /Resize/ })).toBeNull();
  });

  it("clips a multi-day timed Event into a segment per day rather than one all-day banner", async () => {
    installFakeApi({
      events: [
        fakeEvent("Conference call", {
          start_date: "2026-07-03T22:00:00Z",
          due_date: "2026-07-04T02:00:00Z",
        }),
      ],
    });
    render(<App />);
    await openWeek();

    const segments = screen
      .getAllByText("Conference call")
      .map((node) => node.closest(".time-block"))
      .filter((node): node is HTMLElement => node !== null);
    expect(segments).toHaveLength(2);
    expect(segments.some((node) => node.hasAttribute("data-continues-after"))).toBe(true);
    expect(segments.some((node) => node.hasAttribute("data-continues-before"))).toBe(true);
  });
});

describe("The Unscheduled rail (issue #203)", () => {
  it("shows a count and a compact card per Task", async () => {
    installFakeApi({ tasks: [fakeTask("Wash car"), fakeTask("Book dentist")] });
    render(<App />);
    await openCalendar();

    const panel = await screen.findByRole("complementary", { name: "Unscheduled" });
    expect(within(panel).getByText("2")).toBeInTheDocument();
    expect(
      within(panel)
        .getAllByRole("listitem")
        .map((li) => li.className),
    ).toEqual(["unscheduled-card", "unscheduled-card"]);
  });

  it("schedules a card dropped from the rail onto a slot", async () => {
    const api = installFakeApi({ tasks: [fakeTask("Wash car")] });
    render(<App />);
    await openDay();

    const panel = await screen.findByRole("complementary", { name: "Unscheduled" });
    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(closestOrThrow(await within(panel).findByText("Wash car"), "li"), {
      dataTransfer,
    });
    fireEvent.drop(screen.getByLabelText("2026-07-03 09:00"), { dataTransfer });

    await waitFor(() =>
      expect(api.tasks.find((task) => task.title === "Wash car")).toMatchObject({
        start_date: "2026-07-03T09:00:00.000Z",
        is_all_day: false,
      }),
    );
  });

  it("unschedules a Task-block dropped back onto the rail", async () => {
    const api = installFakeApi({
      tasks: [
        fakeTask("Deep work", {
          start_date: "2026-07-03T14:00:00Z",
          due_date: "2026-07-03T15:00:00Z",
          time_zone: "UTC",
        }),
      ],
    });
    render(<App />);
    await openDay();

    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(closestOrThrow(await screen.findByText("Deep work"), ".time-block"), {
      dataTransfer,
    });
    fireEvent.drop(await screen.findByRole("complementary", { name: "Unscheduled" }), {
      dataTransfer,
    });

    await waitFor(() =>
      expect(api.tasks.find((task) => task.title === "Deep work")).toMatchObject({
        due_date: null,
        start_date: null,
      }),
    );
  });
});
