import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import {
  fakeHabit,
  fakeList,
  fakeTag,
  fakeTask,
  INBOX,
  installFakeApi,
  type FakeApiState,
} from "./test/fakeApi";
import { fakeVoiceTransport } from "./test/fakeVoiceTransport";

// Pinned: Friday 2026-07-03 12:00 in the suite's UTC zone, so "tomorrow", "monday" and
// "today" resolve the same way for every runner.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

interface Voice {
  api: FakeApiState;
  call: (name: string, args?: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

/** Renders App with the Voice Assistant configured, starts a session on a provider-neutral fake
 * transport and lets tests call the tab's tools exactly as the agent would. */
async function startVoice(options: FakeApiOptions = {}): Promise<Voice> {
  const api = installFakeApi({
    ...options,
    voiceLivekitUrl: "wss://test.livekit.cloud",
    voiceLivekitApiKey: "key",
    voiceSecretSet: true,
  });
  const fake = fakeVoiceTransport();
  render(<App voiceProvider={fake.provider} />);
  await userEvent
    .setup({ advanceTimers: vi.advanceTimersByTime })
    .click(await screen.findByRole("button", { name: "Start voice assistant" }));
  await waitFor(() => expect(fake.transports[0]?.connected).toBe(true));
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    // act: the agent's call lands outside any user event, and the refresh it triggers updates App.
    let result: unknown;
    await act(async () => {
      result = await fake.transports[0]!.call(name, args);
    });
    return result as Record<string, unknown>;
  };
  return { api, call };
}

type FakeApiOptions = NonNullable<Parameters<typeof installFakeApi>[0]>;
const open = (title: string) => screen.findByRole("button", { name: `Open details for ${title}` });

describe("voice write: create_task", () => {
  it("creates an Inbox task with no read first and shows it live in the view", async () => {
    const { api, call } = await startVoice();
    const result = await call("create_task", { title: "  buy milk  " });
    expect(result).toMatchObject({ title: "buy milk", list_id: INBOX.id });
    expect(api.tasks.map((t) => t.title)).toEqual(["buy milk"]);
    expect(await open("buy milk")).toBeInTheDocument();
  });

  it("a bare day word is all-day; a word with a time uses the tab's IANA zone", async () => {
    const { api, call } = await startVoice();
    await call("create_task", { title: "allday", due: "tomorrow" });
    await call("create_task", { title: "timed", due: "friday 14:30", start: "friday 14:00" });
    await call("create_task", { title: "weekday", due: "monday" });
    const by = (title: string) => api.tasks.find((t) => t.title === title);
    expect(by("allday")).toMatchObject({
      due_date: "2026-07-04T00:00:00Z",
      is_all_day: true,
      time_zone: "UTC",
    });
    expect(by("timed")).toMatchObject({
      start_date: "2026-07-10T14:00:00.000Z",
      due_date: "2026-07-10T14:30:00.000Z",
      is_all_day: false,
      time_zone: "UTC",
    });
    expect(by("weekday")?.due_date).toBe("2026-07-06T00:00:00Z");
  });

  it("resolves List and Tag names case-insensitively against existing ones", async () => {
    const work = fakeList("Work");
    const urgent = fakeTag("Urgent");
    const { api, call } = await startVoice({ lists: [INBOX, work], tags: [urgent] });
    await call("create_task", {
      title: "report",
      list: "work",
      tags: ["URGENT"],
      priority: "high",
      description: "quarterly",
    });
    expect(api.tasks[0]).toMatchObject({
      list_id: work.id,
      priority: "high",
      description: "quarterly",
      tags: [{ id: urgent.id }],
    });
  });

  it("never creates a List or Tag from a spoken name, and says which exist", async () => {
    const { api, call } = await startVoice({
      lists: [INBOX, fakeList("Work")],
      tags: [fakeTag("Urgent")],
    });
    await expect(call("create_task", { title: "x", list: "Gym" })).rejects.toThrow(
      "Unknown list 'Gym' — available lists: Inbox, Work",
    );
    await expect(call("create_task", { title: "x", tags: ["Nope"] })).rejects.toThrow(
      "Unknown tag 'Nope' — available tags: Urgent",
    );
    expect(api.tasks).toEqual([]);
    expect(api.lists).toHaveLength(2);
    expect(api.tags).toHaveLength(1);
    expect(api.requests.filter((r) => r.method !== "GET" && !r.url.includes("/voice/"))).toEqual(
      [],
    );
  });

  it("rejects an empty title and an unparseable date without writing", async () => {
    const { api, call } = await startVoice();
    await expect(call("create_task", { title: "  " })).rejects.toThrow(
      "title must be a non-empty string.",
    );
    await expect(call("create_task", { title: "x", due: "someday" })).rejects.toThrow(
      "Could not understand date 'someday'",
    );
    expect(api.tasks).toEqual([]);
  });

  it("makes the created id writable for later calls in the same session", async () => {
    const { api, call } = await startVoice();
    const created = await call("create_task", { title: "buy milk" });
    await call("set_priority", { task_id: created.id, priority: "low" });
    expect(api.tasks[0]?.priority).toBe("low");
  });
});

describe("voice writes: allowlist", () => {
  it("refuses a Task id no read returned and writes nothing", async () => {
    const task = fakeTask("secret");
    const { api, call } = await startVoice({ tasks: [task] });
    for (const [name, args] of [
      ["schedule_task", { due: "tomorrow" }],
      ["reschedule_task", { due: "tomorrow" }],
      ["complete_task", {}],
      ["set_priority", { priority: "high" }],
      ["set_list", { list: "Inbox" }],
      ["add_tags", { tags: ["x"] }],
      ["add_check_items", { titles: ["x"] }],
    ] as const)
      await expect(call(name, { task_id: task.id, ...args })).rejects.toThrow(
        `Task ${task.id} was not read in this session`,
      );
    expect(api.requests.filter((r) => r.method !== "GET" && !r.url.includes("/voice/"))).toEqual(
      [],
    );
    expect(api.tasks[0]).toMatchObject({ completed: false, priority: "none" });
  });

  it("a read opens the id for writes (get_agenda, search_tasks, get_task)", async () => {
    const inAgenda = fakeTask("a", { due_date: "2026-07-03T00:00:00Z", is_all_day: true });
    const found = fakeTask("findme");
    const single = fakeTask("single");
    const { api, call } = await startVoice({ tasks: [inAgenda, found, single] });
    await call("get_agenda");
    await call("search_tasks", { query: "findme" });
    await call("get_task", { task_id: single.id });
    for (const task of [inAgenda, found, single])
      await call("set_priority", { task_id: task.id, priority: "high" });
    expect(api.tasks.map((t) => t.priority)).toEqual(["high", "high", "high"]);
  });

  it("refuses a Habit id no read returned", async () => {
    const habit = fakeHabit("Meditate");
    const { api, call } = await startVoice({ habits: [habit] });
    await expect(call("check_in_habit", { habit_id: habit.id })).rejects.toThrow(
      `Habit ${habit.id} was not read in this session`,
    );
    expect(api.checkIns).toEqual([]);
  });

  it("a new session starts with an empty allowlist", async () => {
    const task = fakeTask("t");
    const first = await startVoice({ tasks: [task] });
    await first.call("get_task", { task_id: task.id });
    cleanup();
    const second = await startVoice({ tasks: [task] });
    await expect(second.call("complete_task", { task_id: task.id })).rejects.toThrow(
      "was not read in this session",
    );
  });
});

describe("voice writes: scheduling", () => {
  it("schedule_task dates an unscheduled Task and refuses a scheduled one", async () => {
    const plain = fakeTask("plain");
    const dated = fakeTask("dated", { due_date: "2026-07-05T00:00:00Z", is_all_day: true });
    const { api, call } = await startVoice({ tasks: [plain, dated] });
    await call("get_agenda");
    await call("search_tasks", { query: "plain" });
    await call("get_task", { task_id: dated.id });
    await call("schedule_task", { task_id: plain.id, due: "2026-07-08 09:15" });
    expect(api.tasks[0]).toMatchObject({
      due_date: "2026-07-08T09:15:00.000Z",
      is_all_day: false,
      time_zone: "UTC",
    });
    await expect(call("schedule_task", { task_id: dated.id, due: "monday" })).rejects.toThrow(
      `Task ${dated.id} is already scheduled — use reschedule_task.`,
    );
    expect(api.tasks[1]?.due_date).toBe("2026-07-05T00:00:00Z");
  });

  it("reschedule_task moves a dated Task and refuses an unscheduled one", async () => {
    const plain = fakeTask("plain");
    const dated = fakeTask("dated", { due_date: "2026-07-05T00:00:00Z", is_all_day: true });
    const { api, call } = await startVoice({ tasks: [plain, dated] });
    await call("get_task", { task_id: plain.id });
    await call("get_task", { task_id: dated.id });
    await call("reschedule_task", { task_id: dated.id, due: "thursday" });
    expect(api.tasks[1]).toMatchObject({ due_date: "2026-07-09T00:00:00Z", is_all_day: true });
    await expect(call("reschedule_task", { task_id: plain.id, due: "monday" })).rejects.toThrow(
      `Task ${plain.id} is not scheduled — use schedule_task.`,
    );
    expect(api.tasks[0]?.due_date).toBeNull();
  });

  it("requires due and rejects an unknown date word", async () => {
    const dated = fakeTask("dated", { due_date: "2026-07-05T00:00:00Z", is_all_day: true });
    const { call } = await startVoice({ tasks: [dated] });
    await call("get_task", { task_id: dated.id });
    await expect(call("reschedule_task", { task_id: dated.id })).rejects.toThrow(
      "due is required.",
    );
    await expect(call("reschedule_task", { task_id: dated.id, due: "soon" })).rejects.toThrow(
      "Could not understand date 'soon'",
    );
  });

  it("shows the new date in the view that is on screen", async () => {
    const dated = fakeTask("dated", { due_date: "2026-07-05T00:00:00Z", is_all_day: true });
    const { call } = await startVoice({ tasks: [dated] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(await screen.findByRole("button", { name: "Next 7 Days" }));
    await open("dated");
    await call("get_task", { task_id: dated.id });
    await call("reschedule_task", { task_id: dated.id, due: "2026-08-20" });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Open details for dated" })).toBeNull(),
    );
  });
});

describe("voice writes: complete, priority, list", () => {
  it("complete_task closes a plain Task and the open view drops it", async () => {
    const task = fakeTask("laundry");
    const { api, call } = await startVoice({ tasks: [task] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(await screen.findByRole("button", { name: "Inbox" }));
    await open("laundry");
    await call("get_task", { task_id: task.id });
    const result = await call("complete_task", { task_id: task.id });
    expect(result).toMatchObject({ completed: true, advanced_to_next_occurrence: false });
    expect(api.tasks[0]?.completed).toBe(true);
    expect(await screen.findByRole("checkbox", { name: "Complete laundry" })).toBeChecked();
  });

  it("completing a recurring Task reports 'advanced to <date>' and never says it closed", async () => {
    const task = fakeTask("water plants", {
      due_date: "2026-07-03T00:00:00Z",
      is_all_day: true,
      recurrence: "FREQ=WEEKLY;BYDAY=FR",
    });
    const { api, call } = await startVoice({ tasks: [task] });
    await call("get_task", { task_id: task.id });
    const result = await call("complete_task", { task_id: task.id });
    expect(result).toMatchObject({
      completed: false,
      advanced_to_next_occurrence: true,
      result: "advanced to 2026-07-10",
    });
    expect(api.tasks[0]).toMatchObject({ completed: false, due_date: "2026-07-10T00:00:00Z" });
  });

  it("set_priority patches priority and rejects unknown levels", async () => {
    const task = fakeTask("t");
    const { api, call } = await startVoice({ tasks: [task] });
    await call("get_task", { task_id: task.id });
    await call("set_priority", { task_id: task.id, priority: "medium" });
    expect(api.tasks[0]?.priority).toBe("medium");
    await expect(call("set_priority", { task_id: task.id, priority: "urgent" })).rejects.toThrow(
      "priority must be one of: none, low, medium, high.",
    );
    expect(api.tasks[0]?.priority).toBe("medium");
  });

  it("set_list moves the Task to an existing List and never creates one", async () => {
    const work = fakeList("Work");
    const task = fakeTask("t");
    const { api, call } = await startVoice({ lists: [INBOX, work], tasks: [task] });
    await call("get_task", { task_id: task.id });
    await call("set_list", { task_id: task.id, list: "WORK" });
    expect(api.tasks[0]?.list_id).toBe(work.id);
    await expect(call("set_list", { task_id: task.id, list: "Gym" })).rejects.toThrow(
      "Unknown list 'Gym' — available lists: Inbox, Work",
    );
    expect(api.lists).toHaveLength(2);
    expect(api.tasks[0]?.list_id).toBe(work.id);
  });

  it("an unknown Task id reads as not found, not a crash", async () => {
    const task = fakeTask("t");
    const { api, call } = await startVoice({ tasks: [task] });
    await call("get_task", { task_id: task.id });
    api.tasks.length = 0;
    await expect(call("set_priority", { task_id: task.id, priority: "low" })).rejects.toThrow(
      `Task ${task.id} not found.`,
    );
  });
});

describe("voice writes: tags, check items, habits", () => {
  it("add_tags keeps the Tags the Task already has and adds the new ones", async () => {
    const [red, blue, green] = [fakeTag("Red"), fakeTag("Blue"), fakeTag("Green")];
    const task = fakeTask("t", { tags: [{ ...red }] });
    const { api, call } = await startVoice({ tags: [red, blue, green], tasks: [task] });
    await call("get_task", { task_id: task.id });
    const result = await call("add_tags", { task_id: task.id, tags: ["blue", "RED", "green"] });
    expect(api.tasks[0]?.tags.map((t) => t.name).sort()).toEqual(["Blue", "Green", "Red"]);
    expect((result.tags as string[]).sort()).toEqual(["Blue", "Green", "Red"]);
    expect(api.requests.find((r) => r.method === "PATCH")?.body).toEqual({
      tag_ids: [red.id, blue.id, green.id],
    });
  });

  it("add_tags with an unknown Tag fails with the available names and changes nothing", async () => {
    const urgent = fakeTag("Urgent");
    const task = fakeTask("t");
    const { api, call } = await startVoice({ tags: [urgent], tasks: [task] });
    await call("get_task", { task_id: task.id });
    await expect(call("add_tags", { task_id: task.id, tags: ["Urgent", "Nope"] })).rejects.toThrow(
      "Unknown tag 'Nope' — available tags: Urgent",
    );
    expect(api.tags).toHaveLength(1);
    expect(api.tasks[0]?.tags).toEqual([]);
    await expect(call("add_tags", { task_id: task.id, tags: [] })).rejects.toThrow(
      "tags must be a non-empty list",
    );
  });

  it("add_check_items appends each title in order and returns the Task's items", async () => {
    const task = fakeTask("shopping");
    const { api, call } = await startVoice({ tasks: [task] });
    await call("get_task", { task_id: task.id });
    const result = await call("add_check_items", { task_id: task.id, titles: ["eggs", "bread"] });
    expect(api.tasks[0]?.check_items.map((c) => c.title)).toEqual(["eggs", "bread"]);
    expect((result.check_items as { title: string }[]).map((c) => c.title)).toEqual([
      "eggs",
      "bread",
    ]);
    await expect(call("add_check_items", { task_id: task.id, titles: [] })).rejects.toThrow(
      "titles must be a non-empty list of strings.",
    );
  });

  it("check_in_habit defaults to today and value 1, and repeating it keeps one row", async () => {
    const habit = fakeHabit("Meditate");
    const { api, call } = await startVoice({ habits: [habit] });
    await call("get_agenda");
    await call("check_in_habit", { habit_id: habit.id });
    await call("check_in_habit", { habit_id: habit.id });
    expect(api.checkIns).toEqual([
      expect.objectContaining({ habit_id: habit.id, date: "2026-07-03", value: 1 }),
    ]);
  });

  it("check_in_habit records a Numeric value for a given day and rejects a bad day", async () => {
    const habit = fakeHabit("Water", { type: "numeric", target: 8, unit: "glasses" });
    const { api, call } = await startVoice({ habits: [habit] });
    await call("get_agenda");
    await call("check_in_habit", { habit_id: habit.id, day: "2026-07-02", value: 2 });
    expect(api.checkIns[0]).toMatchObject({ date: "2026-07-02", value: 2 });
    await expect(call("check_in_habit", { habit_id: habit.id, day: "yesterday" })).rejects.toThrow(
      "day must be an ISO date YYYY-MM-DD.",
    );
    expect(api.checkIns).toHaveLength(1);
  });

  it("the Habits screen shows a voice check-in live", async () => {
    const habit = fakeHabit("Meditate");
    const { call } = await startVoice({ habits: [habit] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(await screen.findByRole("link", { name: "Habits" }));
    await screen.findByRole("button", { name: "Check in Meditate" });
    await call("get_agenda");
    await call("check_in_habit", { habit_id: habit.id });
    expect(
      await screen.findByRole("button", { name: "Undo check-in Meditate" }),
    ).toBeInTheDocument();
  });
});

describe("voice writes: visible views refresh", () => {
  it("a created Task appears in the open List view, the sidebar count and nothing else needs a reload", async () => {
    const { call } = await startVoice();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(await screen.findByRole("button", { name: "Inbox" }));
    await call("create_task", { title: "buy milk" });
    expect(await open("buy milk")).toBeInTheDocument();
    const lists = await screen.findByRole("navigation", { name: "Lists" });
    expect(await within(lists).findByText("1")).toBeInTheDocument();
  });

  it("a rescheduled Task moves on the Calendar", async () => {
    const task = fakeTask("dentist", { due_date: "2026-07-06T00:00:00Z", is_all_day: true });
    const { call } = await startVoice({ tasks: [task] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(await screen.findByRole("link", { name: "Calendar" }));
    await user.click(await screen.findByRole("button", { name: "Month" }));
    await waitFor(() =>
      expect(within(screen.getByLabelText("2026-07-06")).getByText("dentist")).toBeInTheDocument(),
    );
    await call("get_task", { task_id: task.id });
    await call("reschedule_task", { task_id: task.id, due: "2026-07-08" });
    await waitFor(() =>
      expect(within(screen.getByLabelText("2026-07-08")).getByText("dentist")).toBeInTheDocument(),
    );
    expect(within(screen.getByLabelText("2026-07-06")).queryByText("dentist")).toBeNull();
  });

  it("a failed write refreshes nothing", async () => {
    const { api, call } = await startVoice();
    const before = api.requests.length;
    await expect(call("create_task", { title: "" })).rejects.toThrow();
    expect(api.requests.slice(before)).toEqual([]);
  });
});
