import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { fakeTask, installFakeApi, type RecordedRequest } from "./test/fakeApi";

// Reminder row (#453): chips with remove, plus an add control.

async function openDetail(taskTitle: string): Promise<HTMLElement> {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: `Open details for ${taskTitle}` }));
  return await screen.findByRole("complementary", { name: "Task details" });
}

function lastTaskPatch(requests: RecordedRequest[], taskId: number): unknown {
  const patches = requests.filter(
    (r) => r.method === "PATCH" && r.url === `/api/v1/tasks/${taskId}`,
  );
  return patches.at(-1)?.body;
}

const dated = (title: string, overrides = {}): ReturnType<typeof fakeTask> =>
  fakeTask(title, { due_date: "2026-07-10T15:00:00Z", time_zone: "UTC", ...overrides });

describe("Reminder row in the detail panel", () => {
  it("adds a preset reminder and shows it as a chip", async () => {
    const meeting = dated("Design review");
    const api = installFakeApi({ tasks: [meeting] });
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail("Design review");
    await user.click(within(panel).getByRole("button", { name: "Add reminder" }));
    const menu = within(panel).getByRole("menu", { name: "Add reminder" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["At time of task", "30 minutes before", "1 hour before", "1 day before", "Custom…"]);
    await user.click(within(menu).getByRole("menuitem", { name: "30 minutes before" }));

    const chips = await within(panel).findByRole("list", { name: "Reminders" });
    expect(within(chips).getByText("30 minutes before")).toBeInTheDocument();
    expect(lastTaskPatch(api.requests, meeting.id)).toEqual({ reminders: ["-PT30M"] });
    expect(within(panel).queryByRole("menu", { name: "Add reminder" })).not.toBeInTheDocument();
  });

  it("adds a custom offset built from an amount and a unit", async () => {
    const meeting = dated("Design review");
    const api = installFakeApi({ tasks: [meeting] });
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail("Design review");
    await user.click(within(panel).getByRole("button", { name: "Add reminder" }));
    await user.click(within(panel).getByRole("menuitem", { name: "Custom…" }));
    const amount = within(panel).getByRole("spinbutton", { name: "Offset amount" });
    await user.clear(amount);
    await user.type(amount, "2");
    await user.selectOptions(within(panel).getByRole("combobox", { name: "Offset unit" }), "hours");
    await user.click(within(panel).getByRole("button", { name: "Add" }));

    const chips = await within(panel).findByRole("list", { name: "Reminders" });
    expect(await within(chips).findByText("2 hours before")).toBeInTheDocument();
    expect(lastTaskPatch(api.requests, meeting.id)).toEqual({ reminders: ["-PT2H"] });
  });

  it("shows stored reminders as chips and removes one", async () => {
    const meeting = dated("Design review", { reminders: ["PT0S", "-P2D"] });
    const api = installFakeApi({ tasks: [meeting] });
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail("Design review");
    const chips = within(panel).getByRole("list", { name: "Reminders" });
    expect(within(chips).getByText("At time of task")).toBeInTheDocument();
    expect(within(chips).getByText("2 days before")).toBeInTheDocument();

    await user.click(
      within(chips).getByRole("button", { name: "Remove reminder At time of task" }),
    );

    await waitFor(() =>
      expect(within(chips).queryByText("At time of task")).not.toBeInTheDocument(),
    );
    expect(lastTaskPatch(api.requests, meeting.id)).toEqual({ reminders: ["-P2D"] });
  });

  it("explains that a dateless Task needs a date first", async () => {
    installFakeApi({ tasks: [fakeTask("Someday")] });
    render(<App />);

    const panel = await openDetail("Someday");

    expect(within(panel).getByText("Set a date to add Reminders.")).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Add reminder" })).not.toBeInTheDocument();
  });
});
