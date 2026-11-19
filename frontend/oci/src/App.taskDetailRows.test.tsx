import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import {
  fakeGoal,
  fakeKeyResult,
  fakeList,
  fakeSection,
  fakeTask,
  INBOX,
  installFakeApi,
  type RecordedRequest,
} from "./test/fakeApi";

// Task detail as a document (#452): breadcrumb, title, then property rows
// whose values open a popover and save immediately.

async function openDetail(taskTitle: string): Promise<HTMLElement> {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: `Open details for ${taskTitle}` }));
  return await screen.findByRole("complementary", { name: "Task details" });
}

function patches(requests: RecordedRequest[], taskId: number): unknown[] {
  return requests
    .filter((r) => r.method === "PATCH" && r.url === `/api/v1/tasks/${taskId}`)
    .map((r) => r.body);
}

const dated = (title: string, overrides = {}): ReturnType<typeof fakeTask> =>
  fakeTask(title, { due_date: "2026-07-10T15:00:00Z", time_zone: "UTC", ...overrides });

describe("Task detail property rows", () => {
  it("Priority row shows the glyph and name, and saves the picked level", async () => {
    const report = fakeTask("Write report", { priority: "medium" });
    const api = installFakeApi({ tasks: [report] });
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail("Write report");
    const row = within(panel).getByRole("button", { name: /^Priority.*Medium$/ });
    expect(within(row).getByLabelText("Priority: Medium")).toBeInTheDocument();

    await user.click(row);
    const menu = within(panel).getByRole("menu", { name: "Priority" });
    expect(
      within(menu)
        .getAllByRole("menuitemradio")
        .map((item) => item.textContent),
    ).toEqual(["None", "Low", "Medium", "High"]);
    await user.click(within(menu).getByRole("menuitemradio", { name: "High" }));

    await waitFor(() => expect(patches(api.requests, report.id)).toEqual([{ priority: "high" }]));
    expect(await within(panel).findByRole("button", { name: /^Priority.*High$/ })).toHaveFocus();
  });

  it("opens with Enter, moves with arrows, and Escape returns focus to the row", async () => {
    const report = dated("Write report");
    const api = installFakeApi({ tasks: [report] });
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail("Write report");
    const priority = within(panel).getByRole("button", { name: /^Priority None$/ });
    priority.focus();

    // Arrow keys move between rows.
    await user.keyboard("{ArrowDown}");
    expect(within(panel).getByRole("button", { name: /^Repeat/ })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(priority).toHaveFocus();

    // Enter opens, focus lands on the selected option, arrows move.
    await user.keyboard("{Enter}");
    const menu = within(panel).getByRole("menu", { name: "Priority" });
    expect(within(menu).getByRole("menuitemradio", { name: "None" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(within(menu).getByRole("menuitemradio", { name: "Low" })).toHaveFocus();

    // Escape closes without saving and returns focus to the row.
    await user.keyboard("{Escape}");
    expect(within(panel).queryByRole("menu", { name: "Priority" })).not.toBeInTheDocument();
    expect(priority).toHaveFocus();
    expect(patches(api.requests, report.id)).toEqual([]);

    // Enter on an option picks it.
    await user.keyboard("{Enter}{ArrowDown}{ArrowDown}{Enter}");
    await waitFor(() => expect(patches(api.requests, report.id)).toEqual([{ priority: "medium" }]));
  });

  it("Repeat reads quietly when unset and saves a preset", async () => {
    const workout = dated("Workout");
    const api = installFakeApi({ tasks: [workout] });
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail("Workout");
    const row = within(panel).getByRole("button", { name: "Repeat Doesn't repeat" });
    expect(row).toHaveClass("is-quiet");

    await user.click(row);
    await user.click(within(panel).getByRole("menuitemradio", { name: "Every day" }));

    await waitFor(() =>
      expect(patches(api.requests, workout.id)).toEqual([{ recurrence: "FREQ=DAILY" }]),
    );
    expect(await within(panel).findByRole("button", { name: "Repeat Every day" })).not.toHaveClass(
      "is-quiet",
    );
  });

  it("Key Result row lists task-count Key Results and saves the pick", async () => {
    const goal = fakeGoal("Ship v2");
    goal.key_results = [
      fakeKeyResult(goal.id, "Manual KR", { source: "manual" }),
      fakeKeyResult(goal.id, "Tasks done", { source: "task_count" }),
    ];
    const task = fakeTask("Write code");
    const api = installFakeApi({ goals: [goal], tasks: [task] });
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail("Write code");
    await user.click(within(panel).getByRole("button", { name: "Key Result No Key Result" }));
    const menu = within(panel).getByRole("menu", { name: "Key Result" });
    expect(
      within(menu)
        .getAllByRole("menuitemradio")
        .map((item) => item.textContent),
    ).toEqual(["No Key Result", "Ship v2: Tasks done"]);
    await user.click(within(menu).getByRole("menuitemradio", { name: "Ship v2: Tasks done" }));

    await waitFor(() =>
      expect(patches(api.requests, task.id)).toEqual([{ key_result_id: goal.key_results[1]!.id }]),
    );
    expect(
      await within(panel).findByRole("button", { name: "Key Result Ship v2: Tasks done" }),
    ).toBeInTheDocument();
  });

  it("breadcrumb moves the Task to another List and Section", async () => {
    const groceries = fakeList("Groceries");
    const produce = fakeSection("Produce", groceries.id);
    const report = fakeTask("Write report");
    const api = installFakeApi({
      lists: [INBOX, groceries],
      sections: [produce],
      tasks: [report],
    });
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail("Write report");
    const crumbs = within(panel).getByRole("navigation", { name: "Breadcrumb" });
    await user.click(within(crumbs).getByRole("button", { name: "List Inbox" }));
    await user.click(within(panel).getByRole("menuitemradio", { name: "Groceries" }));
    await waitFor(() =>
      expect(patches(api.requests, report.id)).toEqual([{ list_id: groceries.id }]),
    );

    await user.click(await within(crumbs).findByRole("button", { name: "Section No section" }));
    await user.click(await within(panel).findByRole("menuitemradio", { name: "Produce" }));
    await waitFor(() =>
      expect(patches(api.requests, report.id)).toEqual([
        { list_id: groceries.id },
        { section_id: produce.id },
      ]),
    );
  });

  it("completes the Task from the title checkbox", async () => {
    const report = fakeTask("Write report");
    const api = installFakeApi({ tasks: [report] });
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail("Write report");
    await user.click(within(panel).getByRole("checkbox", { name: "Task complete" }));

    await waitFor(() => expect(patches(api.requests, report.id)).toEqual([{ completed: true }]));
  });
});
