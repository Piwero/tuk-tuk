import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeList, fakeTag, INBOX, installFakeApi, type RecordedRequest } from "./test/fakeApi";

const taskPosts = (requests: RecordedRequest[]): unknown[] =>
  requests.filter((r) => r.method === "POST" && r.url === "/api/v1/tasks").map((r) => r.body);

const parsePosts = (requests: RecordedRequest[]): unknown[] =>
  requests
    .filter((r) => r.method === "POST" && r.url === "/api/v1/assist/parse-capture")
    .map((r) => r.body);

// 2026-09-01 is a Tuesday; the suite runs in UTC so local wall-clock ==
// stored UTC instants. `@tomorrow` resolves to 2026-09-02, `@friday` to
// 2026-09-04.
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

/** A model date deliberately far from any `@` token's resolution, so a
 * payload or chip carrying it is unambiguously Assist's and not the token's. */
const MODEL_DATE = "2026-12-25T09:00:00-05:00";

describe("Quick-Add: an `@` chip outranks Assist's date (issue #213)", () => {
  it("creates the Task with the picked chip's date, never Assist's", async () => {
    const api = installFakeApi({
      lists: [INBOX],
      assistAvailable: true,
      assistParseResult: {
        title: "dentist",
        due_date: MODEL_DATE,
        is_all_day: false,
        time_zone: "America/New_York",
        recurrence: null,
        reminders: [],
        list_name: null,
        tag_names: [],
        priority: null,
      },
    });
    render(<App />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    const input = await openBar(user);
    await screen.findByLabelText("Assist available");
    await user.type(input, "dentist @tomorrow");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(await screen.findByRole("button", { name: "Remove schedule" })).toBeInTheDocument();
    await user.type(input, "{Enter}");

    // The confirmation beat still appears (Assist proposed a date), but it
    // shows the token-resolved schedule, not the model's.
    const chipGroup = await screen.findByRole("group", { name: "Assisted Capture draft" });
    expect(chipGroup).not.toHaveTextContent("Dec");
    expect(chipGroup).not.toHaveTextContent("25");

    await user.keyboard("{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "dentist",
      list_id: INBOX.id,
      due_date: "2026-09-02T00:00:00Z",
      is_all_day: true,
    });
  });

  it("keeps Assist's recurrence, reminder, List, Tag and Priority alongside the `@` chip", async () => {
    const errands = fakeList("Errands");
    const urgent = fakeTag("Urgent");
    const api = installFakeApi({
      lists: [INBOX, errands],
      tags: [urgent],
      assistAvailable: true,
      assistParseResult: {
        title: "water the plants",
        due_date: MODEL_DATE,
        is_all_day: false,
        time_zone: "America/New_York",
        recurrence: "FREQ=WEEKLY",
        reminders: ["-P1D"],
        list_name: "Errands",
        tag_names: ["Urgent"],
        priority: "high",
      },
    });
    render(<App />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    const input = await openBar(user);
    await screen.findByLabelText("Assist available");
    await user.type(input, "water the plants every week @tomorrow");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(await screen.findByRole("button", { name: "Remove schedule" })).toBeInTheDocument();
    await user.type(input, "{Enter}");

    await screen.findByRole("group", { name: "Assisted Capture draft" });
    await user.keyboard("{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "water the plants",
      list_id: errands.id,
      priority: "high",
      tag_ids: [urgent.id],
      due_date: "2026-09-02T00:00:00Z",
      is_all_day: true,
      recurrence: "FREQ=WEEKLY",
      reminders: ["-P1D"],
    });
  });

  it("strips the `@` token from the text sent to the parse endpoint", async () => {
    const api = installFakeApi({
      lists: [INBOX],
      assistAvailable: true,
      assistParseResult: {
        title: "buy milk",
        due_date: MODEL_DATE,
        is_all_day: false,
        time_zone: "America/New_York",
        recurrence: "FREQ=WEEKLY",
        reminders: [],
        list_name: null,
        tag_names: [],
        priority: null,
      },
    });
    render(<App />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    const input = await openBar(user);
    await screen.findByLabelText("Assist available");
    await user.type(input, "@friday buy milk every week{Enter}");

    await waitFor(() => expect(parsePosts(api.requests)).toHaveLength(1));
    expect(parsePosts(api.requests)[0]).toMatchObject({ text: "buy milk every week" });

    // The unrelated recurrence inference still rides through.
    const chipGroup = await screen.findByRole("group", { name: "Assisted Capture draft" });
    expect(within(chipGroup).getByText("weekly")).toBeInTheDocument();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "buy milk",
      list_id: INBOX.id,
      due_date: "2026-09-04T00:00:00Z",
      is_all_day: true,
      recurrence: "FREQ=WEEKLY",
    });
  });

  it("leaves `@` scheduling unaffected when Assist is unavailable", async () => {
    const api = installFakeApi({ lists: [INBOX], assistAvailable: false });
    render(<App />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    const input = await openBar(user);
    await user.type(input, "buy milk @tomorrow{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(parsePosts(api.requests)).toHaveLength(0);
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "buy milk",
      list_id: INBOX.id,
      due_date: "2026-09-02T00:00:00Z",
      is_all_day: true,
    });
  });

  it("submits instantly with the token date when Assist proposes nothing", async () => {
    const api = installFakeApi({ lists: [INBOX], assistAvailable: true });
    render(<App />);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    const input = await openBar(user);
    await screen.findByLabelText("Assist available");
    await user.type(input, "buy milk @tomorrow{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(screen.queryByRole("group", { name: "Assisted Capture draft" })).not.toBeInTheDocument();
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "buy milk",
      list_id: INBOX.id,
      due_date: "2026-09-02T00:00:00Z",
      is_all_day: true,
    });
  });
});
