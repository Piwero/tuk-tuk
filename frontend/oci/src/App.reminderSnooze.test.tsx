import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeReminderClaim, fakeTask, installFakeApi } from "./test/fakeApi";
import { installFakeNotifications } from "./test/fakeNotifications";

// Snoozing a delivered Reminder (issue #566): the in-app card a delivered
// Reminder leaves behind offers Snooze, and says the deadline is unchanged.
// A snooze is a delivery override on the server's ledger, never a Task
// edit; the backend's HTTP tests prove the Task stays byte-identical.

afterEach(() => vi.unstubAllGlobals());

const DUE = "2026-07-10T15:00:00Z";

async function deliveredReminder() {
  const task = fakeTask("Call the dentist", { due_date: DUE, reminders: ["-PT30M"] });
  const api = installFakeApi({
    googleConfigured: false,
    reminderNotifications: true,
    tasks: [task],
    dueReminders: [fakeReminderClaim(task, "-PT30M")],
  });
  installFakeNotifications({ permission: "granted" });
  render(<App />);
  const card = await screen.findByRole("region", { name: "Reminder: Call the dentist" });
  return { api, task, card };
}

function taskWrites(api: ReturnType<typeof installFakeApi>) {
  return api.requests.filter((r) => r.url.startsWith("/api/v1/tasks") && r.method !== "GET");
}

describe("Snoozing a delivered Reminder", () => {
  it("offers snooze on the delivered reminder and says the deadline is unchanged", async () => {
    const { card } = await deliveredReminder();

    expect(within(card).getByText("30 minutes before")).toBeInTheDocument();
    expect(
      within(card).getByText("Snoozing delays only this alert. The deadline stays unchanged."),
    ).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Snooze 10 minutes" })).toBeEnabled();
    expect(within(card).getByRole("button", { name: "Snooze 1 hour" })).toBeEnabled();
  });

  it("snoozes through the ledger and leaves the Task's deadline untouched", async () => {
    const { api, task, card } = await deliveredReminder();

    await userEvent.click(within(card).getByRole("button", { name: "Snooze 10 minutes" }));

    expect(await within(card).findByText(/^Snoozed until \d{1,2}:\d{2}/)).toHaveTextContent(
      "Deadline unchanged.",
    );
    expect(api.reminderSnoozes).toEqual([{ id: api.reminderClaims[0]!.id, minutes: 10 }]);
    expect(taskWrites(api)).toEqual([]);
    expect(api.tasks.find((t) => t.id === task.id)?.due_date).toBe(DUE);
    expect(within(card).queryByRole("button", { name: "Snooze 10 minutes" })).toBeNull();
  });

  it("explains a snooze refused because the Task changed", async () => {
    const { api, task, card } = await deliveredReminder();
    api.tasks.find((t) => t.id === task.id)!.completed = true;

    await userEvent.click(within(card).getByRole("button", { name: "Snooze 1 hour" }));

    expect(
      await within(card).findByText(
        "This reminder can't be snoozed: its Task was completed, moved or changed.",
      ),
    ).toBeInTheDocument();
    expect(taskWrites(api)).toEqual([]);
  });

  it("can be dismissed", async () => {
    const { card } = await deliveredReminder();

    await userEvent.click(within(card).getByRole("button", { name: "Dismiss reminder" }));

    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Reminder: Call the dentist" })).toBeNull(),
    );
  });
});
