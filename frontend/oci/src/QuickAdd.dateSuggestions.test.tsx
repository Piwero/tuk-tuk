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

async function openBar(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(await screen.findByRole("button", { name: "Inbox" }));
  return screen.findByRole("combobox", { name: "Add a task" });
}

describe("Quick-Add @ schedule dropdown", () => {
  it("opens on a bare @ and lists the day vocabulary", async () => {
    installFakeApi({ lists: [INBOX] });
    render(<App />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    const input = await openBar(user);
    await user.type(input, "@");

    const listbox = await screen.findByRole("listbox");
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual([
      "today",
      "tomorrow",
      "weekend",
      "next-week",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ]);
  });

  it("a typed-but-never-picked @tomorrow schedules the task as an all-day date, token stripped", async () => {
    const api = installFakeApi({ lists: [INBOX] });
    render(<App />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    const input = await openBar(user);
    await user.type(input, "email board @tomorrow{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "email board",
      list_id: INBOX.id,
      due_date: "2026-09-02T00:00:00Z",
      is_all_day: true,
    });
  });

  it("picking a suggestion commits a chip, and its × clears the schedule", async () => {
    const api = installFakeApi({ lists: [INBOX] });
    render(<App />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    const input = await openBar(user);
    await user.type(input, "groceries @weekend");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(await screen.findByRole("button", { name: "Remove schedule" })).toBeInTheDocument();
    expect(input).toHaveValue("groceries ");

    await user.click(screen.getByRole("button", { name: "Remove schedule" }));
    expect(screen.queryByRole("button", { name: "Remove schedule" })).toBeNull();

    await user.type(input, "{Enter}");
    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({ title: "groceries", list_id: INBOX.id });
  });

  it("a picked @weekend chip schedules the upcoming Saturday on submit", async () => {
    const api = installFakeApi({ lists: [INBOX] });
    render(<App />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    const input = await openBar(user);
    await user.type(input, "groceries @weekend");
    await user.keyboard("{ArrowDown}{Enter}");
    await user.type(input, "{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "groceries",
      list_id: INBOX.id,
      due_date: "2026-09-05T00:00:00Z",
      is_all_day: true,
    });
  });

  it("leaves an unrecognised @foo in the saved title", async () => {
    const api = installFakeApi({ lists: [INBOX] });
    render(<App />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    const input = await openBar(user);
    await user.type(input, "ping @dave{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({ title: "ping @dave", list_id: INBOX.id });
  });
});
