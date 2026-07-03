import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

describe("Recurrence in the detail panel", () => {
  it("sets a daily repeat from the quick picker", async () => {
    const workout = dated("Workout");
    const api = installFakeApi({ tasks: [workout] });
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail("Workout");
    await user.selectOptions(within(panel).getByRole("combobox", { name: "Repeat" }), "Every day");

    expect(await within(panel).findByText("Every day")).toBeInTheDocument();
    expect(lastTaskPatch(api.requests, workout.id)).toEqual({ recurrence: "FREQ=DAILY" });
  });

  it("shows a stored rule as a readable label", async () => {
    const review = dated("Review", { recurrence: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;COUNT=5" });
    installFakeApi({ tasks: [review] });
    render(<App />);

    const panel = await openDetail("Review");

    expect(
      within(panel).getByText("Every 2 weeks on Mon, Thu — ends after 5 times"),
    ).toBeInTheDocument();
  });

  it("builds a custom weekly rule with weekdays and a count", async () => {
    const review = dated("Review");
    const api = installFakeApi({ tasks: [review] });
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail("Review");
    await user.selectOptions(within(panel).getByRole("combobox", { name: "Repeat" }), "Custom…");
    await user.selectOptions(within(panel).getByRole("combobox", { name: "Frequency" }), "week");
    const interval = within(panel).getByRole("spinbutton", { name: "Repeat every" });
    await user.clear(interval);
    await user.type(interval, "2");
    await user.click(within(panel).getByRole("checkbox", { name: "Repeat on Mon" }));
    await user.click(within(panel).getByRole("checkbox", { name: "Repeat on Thu" }));
    await user.selectOptions(
      within(panel).getByRole("combobox", { name: "Ends" }),
      "After a number of times",
    );
    const times = within(panel).getByRole("spinbutton", { name: "Ends after" });
    await user.clear(times);
    await user.type(times, "5");
    await user.click(within(panel).getByRole("button", { name: "Save repeat" }));

    await waitFor(() =>
      expect(lastTaskPatch(api.requests, review.id)).toEqual({
        recurrence: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;COUNT=5",
      }),
    );
    expect(
      await within(panel).findByText("Every 2 weeks on Mon, Thu — ends after 5 times"),
    ).toBeInTheDocument();
  });

  it("builds a rule that ends on a date", async () => {
    const review = dated("Review");
    const api = installFakeApi({ tasks: [review] });
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail("Review");
    await user.selectOptions(within(panel).getByRole("combobox", { name: "Repeat" }), "Custom…");
    await user.selectOptions(within(panel).getByRole("combobox", { name: "Ends" }), "On a date");
    fireEvent.change(within(panel).getByLabelText("Ends on"), {
      target: { value: "2026-12-31" },
    });
    await user.click(within(panel).getByRole("button", { name: "Save repeat" }));

    await waitFor(() =>
      expect(lastTaskPatch(api.requests, review.id)).toEqual({
        recurrence: "FREQ=DAILY;UNTIL=20261231T235959",
      }),
    );
    expect(await within(panel).findByText("Every day — until 2026-12-31")).toBeInTheDocument();
  });

  it("editing opens the editor primed with the stored rule", async () => {
    const review = dated("Review", { recurrence: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;COUNT=5" });
    installFakeApi({ tasks: [review] });
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail("Review");
    await user.click(within(panel).getByRole("button", { name: "Edit repeat" }));

    expect(within(panel).getByRole("combobox", { name: "Frequency" })).toHaveValue("WEEKLY");
    expect(within(panel).getByRole("spinbutton", { name: "Repeat every" })).toHaveValue(2);
    expect(within(panel).getByRole("checkbox", { name: "Repeat on Mon" })).toBeChecked();
    expect(within(panel).getByRole("checkbox", { name: "Repeat on Thu" })).toBeChecked();
    expect(within(panel).getByRole("checkbox", { name: "Repeat on Fri" })).not.toBeChecked();
    expect(within(panel).getByRole("spinbutton", { name: "Ends after" })).toHaveValue(5);
  });

  it("removes the repeat", async () => {
    const review = dated("Review", { recurrence: "FREQ=DAILY" });
    const api = installFakeApi({ tasks: [review] });
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail("Review");
    await user.click(within(panel).getByRole("button", { name: "Remove repeat" }));

    expect(await within(panel).findByRole("combobox", { name: "Repeat" })).toBeInTheDocument();
    expect(lastTaskPatch(api.requests, review.id)).toEqual({ recurrence: null });
  });

  it("offers no repeat controls on a dateless task", async () => {
    installFakeApi({ tasks: [fakeTask("Someday")] });
    render(<App />);

    const panel = await openDetail("Someday");

    expect(within(panel).getByText("Set a date to make this Task repeat.")).toBeInTheDocument();
    expect(within(panel).queryByRole("combobox", { name: "Repeat" })).not.toBeInTheDocument();
  });
});
