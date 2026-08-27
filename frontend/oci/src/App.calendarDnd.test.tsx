import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { openCalendar, openDay, pinCalendarClock } from "./test/calendar";
import { closestOrThrow, fakeDataTransfer } from "./test/dnd";
import { fakeTask, installFakeApi } from "./test/fakeApi";

pinCalendarClock();

describe("The unscheduled panel", () => {
  it("explains the drag interaction when there is nothing unscheduled", async () => {
    installFakeApi({ tasks: [fakeTask("Dated", { due_date: "2026-07-10T15:00:00Z" })] });
    render(<App />);
    await openCalendar();

    const panel = await screen.findByRole("complementary", { name: "Unscheduled" });
    expect(within(panel).getByText(/drag/i)).toBeInTheDocument();
  });

  it("lists undated open tasks only", async () => {
    installFakeApi({
      tasks: [
        fakeTask("Errand"),
        fakeTask("Dated", { due_date: "2026-07-10T15:00:00Z" }),
        fakeTask("Old chore", { completed: true, completed_at: "2026-06-01T10:00:00Z" }),
      ],
    });
    render(<App />);
    await openCalendar();

    const panel = await screen.findByRole("complementary", { name: "Unscheduled" });
    expect(await within(panel).findByText("Errand")).toBeInTheDocument();
    expect(within(panel).queryByText("Dated")).not.toBeInTheDocument();
    expect(within(panel).queryByText("Old chore")).not.toBeInTheDocument();
  });

  it("schedules a task dropped on a Month cell as all-day that day, removing it from the panel", async () => {
    const api = installFakeApi({ tasks: [fakeTask("Errand")] });
    render(<App />);
    await openCalendar();

    const panel = await screen.findByRole("complementary", { name: "Unscheduled" });
    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(closestOrThrow(await within(panel).findByText("Errand"), "li"), {
      dataTransfer,
    });
    fireEvent.drop(screen.getByLabelText("2026-07-15"), { dataTransfer });

    expect(
      await within(screen.getByLabelText("2026-07-15")).findByText("Errand"),
    ).toBeInTheDocument();
    expect(within(panel).queryByText("Errand")).not.toBeInTheDocument();
    const errand = api.tasks.find((task) => task.title === "Errand");
    expect(errand).toMatchObject({
      start_date: null,
      due_date: "2026-07-15T00:00:00Z",
      is_all_day: true,
      time_zone: "UTC",
    });
  });

  it("schedules a task dropped on an hour cell as a one-hour block", async () => {
    const api = installFakeApi({ tasks: [fakeTask("Errand")] });
    render(<App />);
    await openDay();

    const panel = await screen.findByRole("complementary", { name: "Unscheduled" });
    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(closestOrThrow(await within(panel).findByText("Errand"), "li"), {
      dataTransfer,
    });
    fireEvent.drop(screen.getByLabelText("2026-07-03 09:00"), { dataTransfer });

    await waitFor(() => {
      const mentions = screen.getAllByText("Errand");
      expect(mentions.some((el) => el.closest("[data-start='09:00']") !== null)).toBe(true);
    });
    expect(api.tasks.find((task) => task.title === "Errand")).toMatchObject({
      start_date: "2026-07-03T09:00:00.000Z",
      due_date: "2026-07-03T10:00:00.000Z",
      is_all_day: false,
      time_zone: "UTC",
    });
  });
});

describe("Moving calendar entries", () => {
  it("shifts a multi-day banner dropped on a Month cell, keeping its span", async () => {
    const api = installFakeApi({
      tasks: [
        fakeTask("Offsite", {
          start_date: "2026-06-30T00:00:00Z",
          due_date: "2026-07-02T00:00:00Z",
          is_all_day: true,
        }),
      ],
    });
    render(<App />);
    await openCalendar();

    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(within(screen.getByLabelText("2026-06-30")).getByText("Offsite"), {
      dataTransfer,
    });
    fireEvent.drop(screen.getByLabelText("2026-07-08"), { dataTransfer });

    await waitFor(() =>
      expect(api.tasks.find((task) => task.title === "Offsite")).toMatchObject({
        start_date: "2026-07-08T00:00:00Z",
        due_date: "2026-07-10T00:00:00Z",
        is_all_day: true,
      }),
    );
    expect(
      await within(screen.getByLabelText("2026-07-10")).findByText("Offsite"),
    ).toBeInTheDocument();
  });

  it("moves a timed entry dropped on a Month cell to that day, preserving its duration", async () => {
    const api = installFakeApi({
      tasks: [
        fakeTask("Standup", {
          start_date: "2026-07-03T14:00:00Z",
          due_date: "2026-07-03T15:00:00Z",
          time_zone: "UTC",
        }),
      ],
    });
    render(<App />);
    await openCalendar();

    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(within(screen.getByLabelText("2026-07-03")).getByText("Standup"), {
      dataTransfer,
    });
    fireEvent.drop(screen.getByLabelText("2026-07-05"), { dataTransfer });

    await waitFor(() =>
      expect(api.tasks.find((task) => task.title === "Standup")).toMatchObject({
        start_date: "2026-07-05T14:00:00.000Z",
        due_date: "2026-07-05T15:00:00.000Z",
        is_all_day: false,
      }),
    );
    const cell = screen.getByLabelText("2026-07-05");
    expect(await within(cell).findByText("Standup")).toBeInTheDocument();
    expect(within(cell).getByText("14:00")).toBeInTheDocument();
  });

  it("moves a block dropped on another hour cell, preserving its duration", async () => {
    const api = installFakeApi({
      tasks: [
        fakeTask("Deep work", {
          start_date: "2026-07-03T14:00:00Z",
          due_date: "2026-07-03T15:30:00Z",
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
    fireEvent.drop(screen.getByLabelText("2026-07-03 09:00"), { dataTransfer });

    await waitFor(() =>
      expect(api.tasks.find((task) => task.title === "Deep work")).toMatchObject({
        start_date: "2026-07-03T09:00:00.000Z",
        due_date: "2026-07-03T10:30:00.000Z",
        is_all_day: false,
        time_zone: "UTC",
      }),
    );
    await waitFor(() => {
      const mentions = screen.getAllByText("Deep work");
      expect(mentions.some((el) => el.closest("[data-start='09:00']") !== null)).toBe(true);
    });
  });

  it("turns an all-day banner dragged from the lane onto an hour cell into a one-hour block", async () => {
    const api = installFakeApi({
      tasks: [fakeTask("Conference", { due_date: "2026-07-03T00:00:00Z", is_all_day: true })],
    });
    render(<App />);
    await openDay();

    const lane = screen.getByLabelText("All day");
    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(within(lane).getByText("Conference"), { dataTransfer });
    fireEvent.drop(screen.getByLabelText("2026-07-03 09:00"), { dataTransfer });

    await waitFor(() =>
      expect(api.tasks.find((task) => task.title === "Conference")).toMatchObject({
        start_date: "2026-07-03T09:00:00.000Z",
        due_date: "2026-07-03T10:00:00.000Z",
        is_all_day: false,
        time_zone: "UTC",
      }),
    );
  });

  it("moves an all-day banner dropped on another day's Month cell, keeping it all-day", async () => {
    const api = installFakeApi({
      tasks: [fakeTask("Conference", { due_date: "2026-07-01T00:00:00Z", is_all_day: true })],
    });
    render(<App />);
    await openCalendar();

    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(within(screen.getByLabelText("2026-07-01")).getByText("Conference"), {
      dataTransfer,
    });
    fireEvent.drop(screen.getByLabelText("2026-07-03"), { dataTransfer });

    await waitFor(() =>
      expect(api.tasks.find((task) => task.title === "Conference")).toMatchObject({
        start_date: null,
        due_date: "2026-07-03T00:00:00Z",
        is_all_day: true,
      }),
    );
    expect(
      await within(screen.getByLabelText("2026-07-03")).findByText("Conference"),
    ).toBeInTheDocument();
  });
});

describe("Resizing blocks in the Day view", () => {
  const seedBlock = () =>
    installFakeApi({
      tasks: [
        fakeTask("Deep work", {
          start_date: "2026-07-03T14:00:00Z",
          due_date: "2026-07-03T15:30:00Z",
          time_zone: "UTC",
        }),
      ],
    });

  /** Pointer travel in px for a wanted delta in minutes: one hour is 48px. */
  const px = (minutes: number): number => (minutes / 60) * 48;

  it("drags the bottom edge down to extend the due, snapping to 15 minutes", async () => {
    const api = seedBlock();
    render(<App />);
    await openDay();

    fireEvent.mouseDown(await screen.findByLabelText('Resize end of "Deep work"'), {
      clientY: 500,
    });
    // +85 minutes of travel snaps to +90: 15:30 → 17:00.
    fireEvent.mouseMove(window, { clientY: 500 + px(85) });
    // The pending range previews live, before anything is saved.
    expect(screen.getByText("14:00–17:00")).toBeInTheDocument();
    expect(api.requests.filter((r) => r.method === "PATCH")).toHaveLength(0);
    fireEvent.mouseUp(window);

    await waitFor(() =>
      expect(api.tasks.find((task) => task.title === "Deep work")).toMatchObject({
        start_date: "2026-07-03T14:00:00Z",
        due_date: "2026-07-03T17:00:00.000Z",
      }),
    );
  });

  it("drags the top edge up to move the start earlier", async () => {
    const api = seedBlock();
    render(<App />);
    await openDay();

    fireEvent.mouseDown(await screen.findByLabelText('Resize start of "Deep work"'), {
      clientY: 500,
    });
    fireEvent.mouseMove(window, { clientY: 500 - px(300) });
    fireEvent.mouseUp(window);

    await waitFor(() =>
      expect(api.tasks.find((task) => task.title === "Deep work")).toMatchObject({
        start_date: "2026-07-03T09:00:00.000Z",
        due_date: "2026-07-03T15:30:00Z",
      }),
    );
  });

  it("clamps a shrink at the 15-minute minimum instead of inverting", async () => {
    const api = seedBlock();
    render(<App />);
    await openDay();

    fireEvent.mouseDown(await screen.findByLabelText('Resize end of "Deep work"'), {
      clientY: 500,
    });
    fireEvent.mouseMove(window, { clientY: 500 - px(600) });
    fireEvent.mouseUp(window);

    await waitFor(() =>
      expect(api.tasks.find((task) => task.title === "Deep work")).toMatchObject({
        start_date: "2026-07-03T14:00:00Z",
        due_date: "2026-07-03T14:15:00.000Z",
      }),
    );
  });

  it("caps a drag past midnight at 23:59, within the day", async () => {
    const api = seedBlock();
    render(<App />);
    await openDay();

    fireEvent.mouseDown(await screen.findByLabelText('Resize end of "Deep work"'), {
      clientY: 500,
    });
    fireEvent.mouseMove(window, { clientY: 500 + px(600) });
    fireEvent.mouseUp(window);

    await waitFor(() =>
      expect(api.tasks.find((task) => task.title === "Deep work")).toMatchObject({
        start_date: "2026-07-03T14:00:00Z",
        due_date: "2026-07-03T23:59:00.000Z",
      }),
    );
  });

  it("cancels the resize on Escape, saving nothing", async () => {
    const api = seedBlock();
    render(<App />);
    await openDay();

    fireEvent.mouseDown(await screen.findByLabelText('Resize end of "Deep work"'), {
      clientY: 500,
    });
    fireEvent.mouseMove(window, { clientY: 500 + px(90) });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseUp(window);

    // The block snapped back and nothing was saved.
    expect(screen.getByText("14:00–15:30")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.requests.filter((r) => r.method === "PATCH")).toHaveLength(0);
  });

  it("saves nothing when the edge is released where it started", async () => {
    const api = seedBlock();
    render(<App />);
    await openDay();

    fireEvent.mouseDown(await screen.findByLabelText('Resize end of "Deep work"'), {
      clientY: 500,
    });
    fireEvent.mouseUp(window);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.requests.filter((r) => r.method === "PATCH")).toHaveLength(0);
  });

  it("resizes one snap step per arrow key on a focused handle", async () => {
    const api = seedBlock();
    render(<App />);
    await openDay();

    fireEvent.keyDown(await screen.findByLabelText('Resize end of "Deep work"'), {
      key: "ArrowDown",
    });

    await waitFor(() =>
      expect(api.tasks.find((task) => task.title === "Deep work")).toMatchObject({
        start_date: "2026-07-03T14:00:00Z",
        due_date: "2026-07-03T15:45:00.000Z",
      }),
    );
  });

  it("caps a move through the end of the day at 23:59", async () => {
    const api = seedBlock();
    render(<App />);
    await openDay();

    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(closestOrThrow(await screen.findByText("Deep work"), ".time-block"), {
      dataTransfer,
    });
    fireEvent.drop(screen.getByLabelText("2026-07-03 23:00"), { dataTransfer });

    await waitFor(() =>
      expect(api.tasks.find((task) => task.title === "Deep work")).toMatchObject({
        start_date: "2026-07-03T23:00:00.000Z",
        due_date: "2026-07-03T23:59:00.000Z",
      }),
    );
  });
});
