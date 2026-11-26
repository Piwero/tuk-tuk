import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeTask, installFakeApi, type RecordedRequest } from "./test/fakeApi";

// Planned work (#558): reserved work time on its own row, apart from the
// Due date. Clock pinned to Friday 2026-07-03, local noon (TZ=UTC).
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

function setup(): ReturnType<typeof userEvent.setup> {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}

async function openDetail(taskTitle: string): Promise<HTMLElement> {
  await setup().click(await screen.findByRole("button", { name: `Open details for ${taskTitle}` }));
  return await screen.findByRole("complementary", { name: "Task details" });
}

function patches(requests: RecordedRequest[], taskId: number): unknown[] {
  return requests
    .filter((r) => r.method === "PATCH" && r.url === `/api/v1/tasks/${taskId}`)
    .map((r) => r.body);
}

const DUE = { due_date: "2026-07-10T15:00:00Z", is_all_day: false, time_zone: "UTC" };
const SAVED_PLAN = {
  start: "2026-07-08T09:00:00Z",
  duration_minutes: 90,
  time_zone: "UTC",
  buffer_minutes: 15,
  end: "2026-07-08T10:30:00Z",
};

async function openPlan(panel: HTMLElement): Promise<HTMLElement> {
  await setup().click(within(panel).getByRole("button", { name: /^Planned work / }));
  return within(panel).getByRole("dialog", { name: "Planned work" });
}

describe("Task detail Planned work row", () => {
  it("shows Due date and Planned work as separate rows, unplanned reading quietly", async () => {
    installFakeApi({ tasks: [fakeTask("Report", DUE)] });
    render(<App />);

    const panel = await openDetail("Report");
    expect(within(panel).getByRole("button", { name: "Due date Jul 10, 15:00" })).toBeVisible();
    expect(within(panel).getByRole("button", { name: "Planned work No plan" })).toHaveClass(
      "is-quiet",
    );
  });

  it("shows a saved plan with its Buffer after beside it", async () => {
    installFakeApi({ tasks: [fakeTask("Report", { ...DUE, planned_work: SAVED_PLAN })] });
    render(<App />);

    const panel = await openDetail("Report");
    expect(
      within(panel).getByRole("button", { name: "Planned work Wed, 09:00–10:30" }),
    ).toBeVisible();
    expect(within(panel).getByText("Buffer after 15 min")).toBeVisible();
  });

  it("saves a plan with date and time controls, leaving the due date untouched", async () => {
    const report = fakeTask("Report", DUE);
    const api = installFakeApi({ tasks: [report] });
    const user = setup();
    render(<App />);

    const panel = await openDetail("Report");
    const dialog = await openPlan(panel);
    const save = within(dialog).getByRole("button", { name: "Save plan" });
    const copy = within(dialog).getByText("Moving this block will not change the due date.");
    // The explanatory copy sits immediately above Save plan.
    expect(copy.nextElementSibling).toContainElement(save);

    await user.clear(within(dialog).getByLabelText("Day"));
    await user.type(within(dialog).getByLabelText("Day"), "2026-07-08");
    await user.clear(within(dialog).getByLabelText("Start"));
    await user.type(within(dialog).getByLabelText("Start"), "09:00");
    await user.clear(within(dialog).getByLabelText("Duration (minutes)"));
    await user.type(within(dialog).getByLabelText("Duration (minutes)"), "90");
    await user.type(within(dialog).getByLabelText("Buffer after (minutes)"), "15");
    await user.click(save);

    await waitFor(() =>
      expect(patches(api.requests, report.id)).toEqual([
        {
          planned_work: {
            start: "2026-07-08T09:00:00.000Z",
            duration_minutes: 90,
            time_zone: "UTC",
            buffer_minutes: 15,
          },
        },
      ]),
    );
    expect(
      await within(panel).findByRole("button", { name: "Planned work Wed, 09:00–10:30" }),
    ).toBeVisible();
    expect(within(panel).getByRole("button", { name: "Due date Jul 10, 15:00" })).toBeVisible();
  });

  it("removing the plan says the Task and its deadline remain saved", async () => {
    const report = fakeTask("Report", { ...DUE, planned_work: SAVED_PLAN });
    const api = installFakeApi({ tasks: [report] });
    render(<App />);

    const panel = await openDetail("Report");
    const dialog = await openPlan(panel);
    await setup().click(within(dialog).getByRole("button", { name: "Remove plan" }));

    await waitFor(() => expect(patches(api.requests, report.id)).toEqual([{ planned_work: null }]));
    expect(await within(panel).findByRole("status")).toHaveTextContent(
      "Plan removed. The Task and its due date remain saved.",
    );
    expect(within(panel).getByRole("button", { name: "Planned work No plan" })).toBeVisible();
    expect(within(panel).getByRole("button", { name: "Due date Jul 10, 15:00" })).toBeVisible();
  });

  it("an invalid plan shows the error and keeps the attempted values", async () => {
    const report = fakeTask("Report", { ...DUE, planned_work: SAVED_PLAN });
    installFakeApi({ tasks: [report] });
    const user = setup();
    render(<App />);

    const panel = await openDetail("Report");
    const dialog = await openPlan(panel);
    await user.clear(within(dialog).getByLabelText("Start"));
    await user.type(within(dialog).getByLabelText("Start"), "23:30");
    await user.click(within(dialog).getByRole("button", { name: "Save plan" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("one local day");
    expect(within(dialog).getByLabelText("Start")).toHaveValue("23:30");
    expect(within(dialog).getByLabelText("Duration (minutes)")).toHaveValue(90);
    expect(within(dialog).getByLabelText("Buffer after (minutes)")).toHaveValue(15);
    expect(within(dialog).getByLabelText("Day")).toHaveValue("2026-07-08");
    // The saved plan is still what the row reads.
    expect(
      within(panel).getByRole("button", { name: "Planned work Wed, 09:00–10:30" }),
    ).toBeInTheDocument();
  });
});
