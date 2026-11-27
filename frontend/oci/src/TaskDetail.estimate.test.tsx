import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeTask, installFakeApi } from "./test/fakeApi";

// Duration estimate (#563 review): optional minutes on a Task, used only
// for work planning. Never asked for in Quick-Add (App.capacity.test.tsx
// asserts that); set, changed and removed here in Task detail. Clock pinned
// to Friday 2026-07-03, local noon (TZ=UTC).
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

const DUE = { due_date: "2026-07-10T15:00:00Z", is_all_day: false, time_zone: "UTC" };

describe("Task detail Estimate row", () => {
  it("reads quietly with no estimate, then saves one in minutes", async () => {
    const report = fakeTask("Report", DUE);
    const api = installFakeApi({ tasks: [report] });
    const user = setup();
    render(<App />);

    const panel = await openDetail("Report");
    const row = within(panel).getByRole("button", { name: "Estimate No estimate" });
    expect(row).toHaveClass("is-quiet");
    await user.click(row);
    const dialog = within(panel).getByRole("dialog", { name: "Estimate" });
    await user.type(within(dialog).getByLabelText("Estimate (minutes)"), "45");
    await user.click(within(dialog).getByRole("button", { name: "Save estimate" }));

    expect(await within(panel).findByRole("button", { name: "Estimate 45m" })).toBeInTheDocument();
    expect(api.tasks.find((t) => t.id === report.id)).toMatchObject({
      estimate_minutes: 45,
      due_date: DUE.due_date,
    });
  });

  it("removes an estimate, leaving the Task otherwise as it was", async () => {
    const report = fakeTask("Report", { ...DUE, estimate_minutes: 90 });
    const api = installFakeApi({ tasks: [report] });
    const user = setup();
    render(<App />);

    const panel = await openDetail("Report");
    await user.click(within(panel).getByRole("button", { name: "Estimate 1h 30m" }));
    await user.click(within(panel).getByRole("button", { name: "Remove estimate" }));

    expect(
      await within(panel).findByRole("button", { name: "Estimate No estimate" }),
    ).toBeInTheDocument();
    expect(api.tasks.find((t) => t.id === report.id)?.estimate_minutes).toBeNull();
  });

  it("refuses an estimate that is not a positive number of minutes", async () => {
    const report = fakeTask("Report", DUE);
    const api = installFakeApi({ tasks: [report] });
    const user = setup();
    render(<App />);

    const panel = await openDetail("Report");
    await user.click(within(panel).getByRole("button", { name: "Estimate No estimate" }));
    const dialog = within(panel).getByRole("dialog", { name: "Estimate" });
    await user.type(within(dialog).getByLabelText("Estimate (minutes)"), "0");
    await user.click(within(dialog).getByRole("button", { name: "Save estimate" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Enter a whole number of minutes, at least 1.",
    );
    expect(api.tasks.find((t) => t.id === report.id)?.estimate_minutes ?? null).toBeNull();
  });

  it("prefills a new plan's duration from the estimate", async () => {
    installFakeApi({ tasks: [fakeTask("Report", { ...DUE, estimate_minutes: 25 })] });
    const user = setup();
    render(<App />);

    const panel = await openDetail("Report");
    await user.click(within(panel).getByRole("button", { name: /^Planned work / }));
    const dialog = within(panel).getByRole("dialog", { name: "Planned work" });

    await waitFor(() =>
      expect(within(dialog).getByLabelText("Duration (minutes)")).toHaveValue(25),
    );
  });
});
