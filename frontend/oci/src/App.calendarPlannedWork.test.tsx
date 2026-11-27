import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { type PlannedWorkRead } from "./api";
import { App } from "./App";
import { openCalendar, openDay, pinCalendarClock } from "./test/calendar";
import { fakeDataTransfer } from "./test/dnd";
import { fakeEvent, fakeTask, installFakeApi } from "./test/fakeApi";

pinCalendarClock();

/** A saved Planned work block as the server reads it back (#558): the end
 * is the start plus the duration; the buffer sits after the end. */
function plan(start: string, durationMinutes: number, bufferMinutes: number | null = null) {
  const end = new Date(new Date(start).getTime() + durationMinutes * 60_000);
  return {
    start,
    duration_minutes: durationMinutes,
    time_zone: "UTC",
    buffer_minutes: bufferMinutes,
    end: `${end.toISOString().slice(0, 19)}Z`,
  } satisfies PlannedWorkRead;
}

/** The Day view's Planned work block for a Task title. */
async function findPlannedBlock(title: string): Promise<HTMLElement> {
  return screen.findByRole("group", { name: `Planned work: ${title}` });
}

describe("Planned work in the Calendar view (issue #562)", () => {
  it("renders a plan as its own labelled block, buffer included, away from the due date", async () => {
    installFakeApi({
      tasks: [
        fakeTask("Write report", {
          due_date: "2026-08-20T15:00:00Z",
          time_zone: "UTC",
          planned_work: plan("2026-07-03T10:00:00Z", 60, 15),
        }),
      ],
    });
    render(<App />);
    await openDay();

    const block = await findPlannedBlock("Write report");
    expect(block).toHaveAttribute("data-kind", "planned");
    expect(block).toHaveAttribute("data-start", "10:00");
    expect(block).toHaveAttribute("data-end", "11:00");
    expect(within(block).getByText("Planned work")).toBeInTheDocument();
    expect(within(block).getByText("Write report")).toBeInTheDocument();
    expect(within(block).getByText("Buffer after 15 min")).toBeInTheDocument();
  });

  it("names a coinciding schedule and plan apart instead of drawing two identical blocks", async () => {
    installFakeApi({
      tasks: [
        fakeTask("Write report", {
          start_date: "2026-07-03T10:00:00Z",
          due_date: "2026-07-03T11:00:00Z",
          time_zone: "UTC",
          planned_work: plan("2026-07-03T10:00:00Z", 60),
        }),
      ],
    });
    render(<App />);
    await openDay();

    const planned = await findPlannedBlock("Write report");
    const blocks = screen
      .getAllByText("Write report")
      .map((title) => title.closest(".time-block"))
      .filter((block): block is HTMLElement => block !== null);
    expect(blocks).toHaveLength(2);
    const schedule = blocks.find((block) => block !== planned) as HTMLElement;
    expect(schedule).toHaveAttribute("data-kind", "task");
    expect(within(schedule).getByText("Due date")).toBeInTheDocument();
    expect(within(schedule).queryByText("Planned work")).toBeNull();
    expect(within(planned).queryByText("Due date")).toBeNull();
    // Their controls are named apart too: one completion checkbox, on the
    // Task's own entry, and resize handles that say which block they move.
    expect(screen.getAllByRole("checkbox", { name: "Complete Write report" })).toHaveLength(1);
    expect(within(schedule).getByRole("button", { name: 'Resize end of "Write report"' }));
    expect(
      within(planned).getByRole("button", { name: 'Resize end of planned work "Write report"' }),
    );
  });

  it("moves only the plan when its block is dropped on another hour", async () => {
    const api = installFakeApi({
      tasks: [
        fakeTask("Write report", {
          due_date: "2026-07-03T18:00:00Z",
          time_zone: "UTC",
          planned_work: plan("2026-07-03T10:00:00Z", 60, 15),
        }),
      ],
    });
    render(<App />);
    await openDay();

    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(await findPlannedBlock("Write report"), { dataTransfer });
    fireEvent.drop(screen.getByLabelText("2026-07-03 14:00"), { dataTransfer });

    await waitFor(() =>
      expect(screen.getByRole("group", { name: "Planned work: Write report" })).toHaveAttribute(
        "data-start",
        "14:00",
      ),
    );
    const task = api.tasks.find((candidate) => candidate.title === "Write report");
    expect(task).toMatchObject({
      start_date: null,
      due_date: "2026-07-03T18:00:00Z",
      planned_work: { start: "2026-07-03T14:00:00.000Z", duration_minutes: 60, buffer_minutes: 15 },
    });
    const writes = api.requests.filter((r) => r.method !== "GET");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.url).toBe(`/api/v1/tasks/${task?.id}`);
    expect(Object.keys(writes[0]?.body as object)).toEqual(["planned_work"]);
  });

  it("moves a plan to another day from the Month grid, keeping its time", async () => {
    const api = installFakeApi({
      tasks: [
        fakeTask("Write report", {
          due_date: "2026-07-20T18:00:00Z",
          time_zone: "UTC",
          planned_work: plan("2026-07-03T10:00:00Z", 60),
        }),
      ],
    });
    render(<App />);
    await openCalendar();

    const cell = screen.getByLabelText("2026-07-03");
    const row = (await within(cell).findByText("Planned work")).closest(
      ".calendar-timed-entry",
    ) as HTMLElement;
    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(row, { dataTransfer });
    fireEvent.drop(screen.getByLabelText("2026-07-08"), { dataTransfer });

    await waitFor(() =>
      expect(api.tasks.find((task) => task.title === "Write report")).toMatchObject({
        due_date: "2026-07-20T18:00:00Z",
        planned_work: { start: "2026-07-08T10:00:00.000Z", duration_minutes: 60 },
      }),
    );
    expect(
      await within(screen.getByLabelText("2026-07-08")).findByText("Planned work"),
    ).toBeInTheDocument();
  });

  it("resizes only the plan when its end edge is dragged", async () => {
    const api = installFakeApi({
      tasks: [
        fakeTask("Write report", {
          start_date: "2026-07-03T10:00:00Z",
          due_date: "2026-07-03T11:00:00Z",
          time_zone: "UTC",
          planned_work: plan("2026-07-03T10:00:00Z", 60),
        }),
      ],
    });
    render(<App />);
    await openDay();

    fireEvent.mouseDown(
      await screen.findByRole("button", { name: 'Resize end of planned work "Write report"' }),
      { clientY: 500 },
    );
    // 48px is one hour on the uniform axis: +30 minutes of travel.
    fireEvent.mouseMove(window, { clientY: 524 });
    fireEvent.mouseUp(window);

    await waitFor(() =>
      expect(api.tasks.find((task) => task.title === "Write report")).toMatchObject({
        start_date: "2026-07-03T10:00:00Z",
        due_date: "2026-07-03T11:00:00Z",
        planned_work: { start: "2026-07-03T10:00:00.000Z", duration_minutes: 90 },
      }),
    );
  });

  it("offers the plan's date and time controls from the block, as an alternative to dragging", async () => {
    installFakeApi({
      tasks: [
        fakeTask("Write report", {
          due_date: "2026-07-20T18:00:00Z",
          time_zone: "UTC",
          planned_work: plan("2026-07-03T10:00:00Z", 60),
        }),
      ],
    });
    render(<App />);
    await openDay();

    fireEvent.click(await findPlannedBlock("Write report"));
    const panel = await screen.findByRole("complementary", { name: "Task details" });
    fireEvent.click(within(panel).getByRole("button", { name: /^Planned work / }));
    const dialog = within(panel).getByRole("dialog", { name: "Planned work" });
    fireEvent.change(within(dialog).getByLabelText("Start"), { target: { value: "15:00" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save plan" }));

    await waitFor(() =>
      expect(screen.getByRole("group", { name: "Planned work: Write report" })).toHaveAttribute(
        "data-start",
        "15:00",
      ),
    );
  });
});

describe("Events beside Planned work (issue #562)", () => {
  it("keeps an Event read-only: labelled so, not draggable, no resize handles", async () => {
    installFakeApi({
      googleConfigured: true,
      events: [
        fakeEvent("Standup", {
          start_date: "2026-07-03T09:00:00Z",
          due_date: "2026-07-03T09:30:00Z",
        }),
      ],
      tasks: [fakeTask("Write report", { planned_work: plan("2026-07-03T09:00:00Z", 60) })],
    });
    render(<App />);
    await openDay();

    const block = (await screen.findByText("Standup")).closest(".time-block") as HTMLElement;
    expect(block).toHaveAttribute("data-kind", "event");
    expect(within(block).getByText("Event · read-only")).toBeInTheDocument();
    expect(within(block).queryByText("Planned work")).toBeNull();
    expect(block).not.toHaveAttribute("draggable");
    expect(within(block).queryByRole("button", { name: /Resize/ })).toBeNull();
  });
});
