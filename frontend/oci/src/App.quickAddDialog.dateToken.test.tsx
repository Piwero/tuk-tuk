import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { installFakeApi, INBOX, type RecordedRequest } from "./test/fakeApi";

const taskPosts = (requests: RecordedRequest[]): unknown[] =>
  requests.filter((r) => r.method === "POST" && r.url === "/api/v1/tasks").map((r) => r.body);

// 2026-09-01 is a Tuesday; the suite runs in UTC so local wall-clock ==
// stored UTC instants.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-09-01T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

async function openDialog(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(await screen.findByRole("button", { name: "Inbox" }));
  await user.click(screen.getByRole("button", { name: "Quick add" }));
  return screen.findByRole("dialog", { name: "Quick add" });
}

describe("Quick add dialog — @ schedule tokens", () => {
  it("opens the day vocabulary on a bare @ in the Title", async () => {
    installFakeApi({ lists: [INBOX] });
    render(<App />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await openDialog(user);

    await user.type(screen.getByLabelText("Title"), "@");

    const listbox = await screen.findByRole("listbox");
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual([
      "Today",
      "Tomorrow",
      "Weekend",
      "Next-week",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]);
  });

  it("picking a suggestion fills the Date fieldset, not a chip row", async () => {
    const api = installFakeApi({ lists: [INBOX] });
    render(<App />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const dialog = await openDialog(user);

    await user.type(screen.getByLabelText("Title"), "groceries @tomorrow");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(screen.getByLabelText("Due day")).toHaveValue("2026-09-02");
    // No chip row — the schedule lives in the fieldset only.
    expect(within(dialog).queryByLabelText("Remove schedule")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "groceries",
      list_id: INBOX.id,
      due_date: "2026-09-02T00:00:00Z",
      is_all_day: true,
      time_zone: expect.any(String),
    });
  });

  it("carries a clock time from the picked chip into the Due time", async () => {
    const api = installFakeApi({ lists: [INBOX] });
    render(<App />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await openDialog(user);

    await user.type(screen.getByLabelText("Title"), "standup @tomorrow");
    await user.keyboard("{ArrowDown}{Enter}");
    await user.type(screen.getByLabelText("Title"), " @9am");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(screen.getByLabelText("Day")).toHaveValue("2026-09-02");
    expect(screen.getByLabelText("Due time")).toHaveValue("09:00");

    await user.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toMatchObject({
      title: "standup",
      is_all_day: false,
      due_date: new Date(2026, 8, 2, 9, 0).toISOString(),
    });
  });

  it("resolves a typed-but-never-picked @tomorrow at submit, token stripped", async () => {
    const api = installFakeApi({ lists: [INBOX] });
    render(<App />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await openDialog(user);

    await user.type(screen.getByLabelText("Title"), "email board @tomorrow");
    await user.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "email board",
      list_id: INBOX.id,
      due_date: "2026-09-02T00:00:00Z",
      is_all_day: true,
    });
  });

  it("a hand-set Date fieldset wins over a raw @ token", async () => {
    const api = installFakeApi({ lists: [INBOX] });
    render(<App />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const dialog = await openDialog(user);

    await user.type(screen.getByLabelText("Title"), "plan @tomorrow");
    await user.click(within(dialog).getByRole("button", { name: "Next Week" }));
    await user.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toMatchObject({
      title: "plan",
      due_date: "2026-09-07T00:00:00Z",
      is_all_day: true,
    });
  });

  it("Assist does not overwrite a date set by an @ token", async () => {
    const api = installFakeApi({
      lists: [INBOX],
      assistAvailable: true,
      assistParseResult: {
        title: "call bank",
        due_date: "2026-12-25T00:00:00Z",
        is_all_day: true,
        time_zone: null,
        recurrence: null,
        reminders: [],
        list_name: null,
        tag_names: [],
        priority: null,
      },
    });
    render(<App />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const dialog = await openDialog(user);

    await user.type(screen.getByLabelText("Title"), "call bank @tomorrow");
    await within(dialog).findByLabelText("Assist available");
    await user.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toMatchObject({
      title: "call bank",
      due_date: "2026-09-02T00:00:00Z",
      is_all_day: true,
    });
  });
});
