import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { fakeTask, installFakeApi, type RecordedRequest } from "./test/fakeApi";

// Note: fetch stays stubbed across tests (each test installs a fresh fake).

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

describe("Reminders in the detail panel", () => {
  it("adds a preset reminder and shows it in the list", async () => {
    const meeting = dated("Design review");
    const api = installFakeApi({ tasks: [meeting] });
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail("Design review");
    await user.selectOptions(
      within(panel).getByRole("combobox", { name: "Add a reminder" }),
      "30 minutes before",
    );

    const list = await within(panel).findByRole("list", { name: "Reminders" });
    expect(within(list).getByText("30 minutes before")).toBeInTheDocument();
    expect(lastTaskPatch(api.requests, meeting.id)).toEqual({ reminders: ["-PT30M"] });
  });

  it("adds a custom offset built from an amount and a unit", async () => {
    const meeting = dated("Design review");
    const api = installFakeApi({ tasks: [meeting] });
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail("Design review");
    await user.selectOptions(
      within(panel).getByRole("combobox", { name: "Add a reminder" }),
      "Custom…",
    );
    const amount = within(panel).getByRole("spinbutton", { name: "Offset amount" });
    await user.clear(amount);
    await user.type(amount, "2");
    await user.selectOptions(within(panel).getByRole("combobox", { name: "Offset unit" }), "hours");
    await user.click(within(panel).getByRole("button", { name: "Add reminder" }));

    const list = await within(panel).findByRole("list", { name: "Reminders" });
    expect(await within(list).findByText("2 hours before")).toBeInTheDocument();
    expect(lastTaskPatch(api.requests, meeting.id)).toEqual({ reminders: ["-PT2H"] });
  });

  it("shows stored reminders with readable labels and removes one", async () => {
    const meeting = dated("Design review", { reminders: ["PT0S", "-P2D"] });
    const api = installFakeApi({ tasks: [meeting] });
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail("Design review");
    const list = within(panel).getByRole("list", { name: "Reminders" });
    expect(within(list).getByText("At time of task")).toBeInTheDocument();
    expect(within(list).getByText("2 days before")).toBeInTheDocument();

    await user.click(within(list).getByRole("button", { name: "Remove reminder At time of task" }));

    await waitFor(() =>
      expect(within(list).queryByText("At time of task")).not.toBeInTheDocument(),
    );
    expect(lastTaskPatch(api.requests, meeting.id)).toEqual({ reminders: ["-P2D"] });
  });

  it("offers no reminder controls on a dateless task", async () => {
    installFakeApi({ tasks: [fakeTask("Someday")] });
    render(<App />);

    const panel = await openDetail("Someday");

    expect(within(panel).getByText("Set a date to add Reminders.")).toBeInTheDocument();
    expect(
      within(panel).queryByRole("combobox", { name: "Add a reminder" }),
    ).not.toBeInTheDocument();
  });
});
