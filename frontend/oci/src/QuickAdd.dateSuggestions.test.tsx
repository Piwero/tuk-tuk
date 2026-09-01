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

  it.each([
    ["day then time", "email board @tomorrow @8am"],
    ["time then day", "email board @8am @tomorrow"],
  ])("composes @tomorrow @8am into one timed schedule (%s)", async (_label, phrase) => {
    const api = installFakeApi({ lists: [INBOX] });
    render(<App />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const input = await openBar(user);
    await user.type(input, `${phrase}{Enter}`);

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "email board",
      list_id: INBOX.id,
      due_date: "2026-09-02T08:00:00.000Z",
      is_all_day: false,
      time_zone: "UTC",
    });
  });

  it("a picked @tomorrow chip takes a typed @8am, rendering the composed schedule", async () => {
    const api = installFakeApi({ lists: [INBOX] });
    render(<App />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    const input = await openBar(user);
    await user.type(input, "standup @tomorrow");
    await user.keyboard("{ArrowDown}{Enter}");
    await user.type(input, "@8am");
    await user.keyboard("{ArrowDown}{Enter}");

    // One chip, one remove button — never an orphan time.
    expect(screen.getAllByRole("button", { name: "Remove schedule" })).toHaveLength(1);
    expect(screen.getByText("Tomorrow 8:00 AM")).toBeInTheDocument();

    await user.type(input, "{Enter}");
    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "standup",
      list_id: INBOX.id,
      due_date: "2026-09-02T08:00:00.000Z",
      is_all_day: false,
      time_zone: "UTC",
    });
  });

  it("a second day token replaces the day and keeps the time", async () => {
    const api = installFakeApi({ lists: [INBOX] });
    render(<App />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    const input = await openBar(user);
    // 2026-09-01 is a Tuesday → @monday is 2026-09-07.
    await user.type(input, "review @tomorrow @8am @monday{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "review",
      list_id: INBOX.id,
      due_date: "2026-09-07T08:00:00.000Z",
      is_all_day: false,
      time_zone: "UTC",
    });
  });

  it("the chip's × clears a composed day+time schedule whole", async () => {
    const api = installFakeApi({ lists: [INBOX] });
    render(<App />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    const input = await openBar(user);
    await user.type(input, "sync @tomorrow");
    await user.keyboard("{ArrowDown}{Enter}");
    await user.type(input, "@8am");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(await screen.findByText("Tomorrow 8:00 AM")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove schedule" }));
    await user.type(input, "{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({ title: "sync", list_id: INBOX.id });
  });

  it("a time typed raw after a chip that already has one overwrites the time half", async () => {
    const api = installFakeApi({ lists: [INBOX] });
    render(<App />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    const input = await openBar(user);
    await user.type(input, "ship @tomorrow");
    await user.keyboard("{ArrowDown}{Enter}");
    await user.type(input, "@8am");
    await user.keyboard("{ArrowDown}{Enter}");
    // Typed straight to submit, never picked from the dropdown.
    await user.type(input, "@9pm{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "ship",
      list_id: INBOX.id,
      due_date: "2026-09-02T21:00:00.000Z",
      is_all_day: false,
      time_zone: "UTC",
    });
  });

  it("a time token alone schedules today at that hour, even one already past", async () => {
    const api = installFakeApi({ lists: [INBOX] });
    render(<App />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    const input = await openBar(user);
    // System time is 12:00 — 8am today is in the past, and stays today.
    await user.type(input, "call mum @8am{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "call mum",
      list_id: INBOX.id,
      due_date: "2026-09-01T08:00:00.000Z",
      is_all_day: false,
      time_zone: "UTC",
    });
  });
});
