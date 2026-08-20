import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { fakeList, fakeTag, INBOX, installFakeApi, type RecordedRequest } from "./test/fakeApi";

const taskPosts = (requests: RecordedRequest[]): unknown[] =>
  requests.filter((r) => r.method === "POST" && r.url === "/api/v1/tasks").map((r) => r.body);

const parsePosts = (requests: RecordedRequest[]): unknown[] =>
  requests
    .filter((r) => r.method === "POST" && r.url === "/api/v1/assist/parse-capture")
    .map((r) => r.body);

describe("Assisted Capture (ADR 0005, issue #43)", () => {
  it("renders the proposed draft as chips and confirms it into a Task on a second Enter", async () => {
    const api = installFakeApi({
      assistAvailable: true,
      assistParseResult: {
        title: "dentist",
        due_date: "2026-08-18T15:00:00-04:00",
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
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await screen.findByLabelText("Assist available");
    await user.type(input, "dentist tuesday 3pm{Enter}");

    await waitFor(() => expect(parsePosts(api.requests)).toHaveLength(1));
    expect(parsePosts(api.requests)[0]).toMatchObject({ text: "dentist tuesday 3pm" });

    const chipGroup = await screen.findByRole("group", { name: "Assisted Capture draft" });
    expect(chipGroup).toHaveTextContent("dentist");

    await user.keyboard("{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "dentist",
      list_id: 1,
      due_date: "2026-08-18T15:00:00-04:00",
      is_all_day: false,
      time_zone: "America/New_York",
    });
  });

  it("discards the draft and saves the task exactly as typed", async () => {
    const api = installFakeApi({
      assistAvailable: true,
      assistParseResult: {
        title: "dentist",
        due_date: "2026-08-18T15:00:00-04:00",
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
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await screen.findByLabelText("Assist available");
    await user.type(input, "dentist tuesday 3pm{Enter}");
    await screen.findByRole("group", { name: "Assisted Capture draft" });

    await user.click(screen.getByRole("button", { name: "Discard suggestion" }));

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "dentist tuesday 3pm",
      list_id: 1,
    });
  });

  it("discards the draft on Escape, saving the task as typed", async () => {
    const api = installFakeApi({
      assistAvailable: true,
      assistParseResult: {
        title: "dentist",
        due_date: "2026-08-18T15:00:00-04:00",
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
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await screen.findByLabelText("Assist available");
    await user.type(input, "dentist tuesday 3pm{Enter}");
    await screen.findByRole("group", { name: "Assisted Capture draft" });

    await user.keyboard("{Escape}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "dentist tuesday 3pm",
      list_id: 1,
    });
  });

  it("saves as typed with no confirmation beat when the extraction has no date", async () => {
    const api = installFakeApi({ assistAvailable: true });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "call mom{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({ title: "call mom", list_id: 1 });
    expect(screen.queryByRole("group", { name: "Assisted Capture draft" })).not.toBeInTheDocument();
  });

  it("degrades to plain capture, with no error shown, when the parse request fails", async () => {
    const api = installFakeApi({ assistAvailable: true, assistParseFails: true });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await screen.findByLabelText("Assist available");
    await user.type(input, "dentist tuesday 3pm{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({ title: "dentist tuesday 3pm", list_id: 1 });
    expect(screen.queryByRole("group", { name: "Assisted Capture draft" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("triggers no parse and behaves exactly as today's Quick-Add when Assist is unavailable", async () => {
    const api = installFakeApi({ assistAvailable: false });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "call mom{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(parsePosts(api.requests)).toHaveLength(0);
    expect(taskPosts(api.requests)[0]).toEqual({ title: "call mom", list_id: 1 });
  });
});

describe("Assisted Capture recurrence and reminders (issue #44)", () => {
  it("renders a recurrence chip and confirms it into the Task's recurrence", async () => {
    const api = installFakeApi({
      assistAvailable: true,
      assistParseResult: {
        title: "pay rent",
        due_date: "2026-08-18T00:00:00Z",
        is_all_day: true,
        time_zone: null,
        recurrence: "FREQ=MONTHLY;BYMONTHDAY=1",
        reminders: [],
        list_name: null,
        tag_names: [],
        priority: null,
      },
    });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await screen.findByLabelText("Assist available");
    await user.type(input, "pay rent every month on the 1st{Enter}");

    const chipGroup = await screen.findByRole("group", { name: "Assisted Capture draft" });
    expect(chipGroup).toHaveTextContent("monthly on the 1st");

    await user.keyboard("{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "pay rent",
      list_id: 1,
      due_date: "2026-08-18T00:00:00Z",
      is_all_day: true,
      recurrence: "FREQ=MONTHLY;BYMONTHDAY=1",
    });
  });

  it("renders a reminder chip and confirms it into the Task's reminders", async () => {
    const api = installFakeApi({
      assistAvailable: true,
      assistParseResult: {
        title: "dentist",
        due_date: "2026-08-18T15:00:00-04:00",
        is_all_day: false,
        time_zone: "America/New_York",
        recurrence: null,
        reminders: ["-P1D"],
        list_name: null,
        tag_names: [],
        priority: null,
      },
    });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await screen.findByLabelText("Assist available");
    await user.type(input, "dentist tuesday 3pm remind me the day before{Enter}");

    const chipGroup = await screen.findByRole("group", { name: "Assisted Capture draft" });
    expect(chipGroup).toHaveTextContent("1 day before");

    await user.keyboard("{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "dentist",
      list_id: 1,
      due_date: "2026-08-18T15:00:00-04:00",
      is_all_day: false,
      time_zone: "America/New_York",
      reminders: ["-P1D"],
    });
  });

  it("discarding the draft drops the recurrence and reminders, saving as typed", async () => {
    const api = installFakeApi({
      assistAvailable: true,
      assistParseResult: {
        title: "pay rent",
        due_date: "2026-08-18T00:00:00Z",
        is_all_day: true,
        time_zone: null,
        recurrence: "FREQ=MONTHLY;BYMONTHDAY=1",
        reminders: ["-P1D"],
        list_name: null,
        tag_names: [],
        priority: null,
      },
    });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await screen.findByLabelText("Assist available");
    await user.type(input, "pay rent every month on the 1st remind me the day before{Enter}");
    await screen.findByRole("group", { name: "Assisted Capture draft" });

    await user.click(screen.getByRole("button", { name: "Discard suggestion" }));

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "pay rent every month on the 1st remind me the day before",
      list_id: 1,
    });
  });
});

describe("Assisted Capture list/tag/priority matching (issue #45)", () => {
  it("proposes a List/Tag/Priority chip and confirms them into the created Task", async () => {
    const errands = fakeList("Errands");
    const urgent = fakeTag("Urgent");
    const api = installFakeApi({
      lists: [INBOX, errands],
      tags: [urgent],
      assistAvailable: true,
      assistParseResult: {
        title: "buy milk",
        due_date: null,
        is_all_day: false,
        time_zone: null,
        recurrence: null,
        reminders: [],
        list_name: "Errands",
        tag_names: ["Urgent"],
        priority: "high",
      },
    });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await screen.findByLabelText("Assist available");
    await user.type(input, "buy milk in my errands list urgent high priority{Enter}");

    const chipGroup = await screen.findByRole("group", { name: "Assisted Capture draft" });
    expect(chipGroup).toHaveTextContent("Errands");
    expect(chipGroup).toHaveTextContent("Urgent");
    expect(chipGroup).toHaveTextContent("High");

    await user.keyboard("{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "buy milk",
      list_id: errands.id,
      priority: "high",
      tag_ids: [urgent.id],
    });
  });

  it("drops a hallucinated List/Tag name never sent as a candidate", async () => {
    const api = installFakeApi({
      lists: [INBOX],
      tags: [],
      assistAvailable: true,
      assistParseResult: {
        title: "buy milk",
        due_date: null,
        is_all_day: false,
        time_zone: null,
        recurrence: null,
        reminders: [],
        list_name: null,
        tag_names: [],
        priority: null,
      },
    });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "buy milk{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({ title: "buy milk", list_id: INBOX.id });
    expect(screen.queryByRole("group", { name: "Assisted Capture draft" })).not.toBeInTheDocument();
  });

  it("sends only the residual text after explicit tokens are stripped, and an explicit #tag/!priority/~list token wins over a same-field Assist proposal", async () => {
    const errands = fakeList("Errands");
    const work = fakeList("Work");
    const urgent = fakeTag("Urgent");
    const api = installFakeApi({
      lists: [INBOX, errands, work],
      tags: [urgent],
      assistAvailable: true,
      assistParseResult: {
        title: "buy milk",
        due_date: null,
        is_all_day: false,
        time_zone: null,
        recurrence: null,
        reminders: [],
        list_name: "Errands",
        tag_names: ["Urgent"],
        priority: "low",
      },
    });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await screen.findByLabelText("Assist available");
    await user.type(input, "buy milk !high ~Work{Enter}");

    await waitFor(() => expect(parsePosts(api.requests)).toHaveLength(1));
    expect(parsePosts(api.requests)[0]).toMatchObject({ text: "buy milk" });

    await screen.findByRole("group", { name: "Assisted Capture draft" });
    await user.keyboard("{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "buy milk",
      list_id: work.id,
      priority: "high",
      tag_ids: [urgent.id],
    });
  });

  it("parses Spanish input into chips the same way as English (issue #46)", async () => {
    const api = installFakeApi({
      assistAvailable: true,
      assistParseResult: {
        title: "dentista",
        due_date: "2026-08-18T15:00:00-04:00",
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
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await screen.findByLabelText("Assist available");
    await user.type(input, "dentista martes a las 3{Enter}");

    await waitFor(() => expect(parsePosts(api.requests)).toHaveLength(1));
    expect(parsePosts(api.requests)[0]).toMatchObject({ text: "dentista martes a las 3" });

    const chipGroup = await screen.findByRole("group", { name: "Assisted Capture draft" });
    expect(chipGroup).toHaveTextContent("dentista");

    await user.keyboard("{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "dentista",
      list_id: 1,
      due_date: "2026-08-18T15:00:00-04:00",
      is_all_day: false,
      time_zone: "America/New_York",
    });
  });
});

describe("Assisted Capture per-chip removal (issue #47)", () => {
  it("removing the date chip drops the date from the confirmed payload and restores the typed title", async () => {
    const api = installFakeApi({
      assistAvailable: true,
      assistParseResult: {
        title: "dentist",
        due_date: "2026-08-18T15:00:00-04:00",
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
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await screen.findByLabelText("Assist available");
    await user.type(input, "dentist tuesday 3pm{Enter}");
    await screen.findByRole("group", { name: "Assisted Capture draft" });

    await user.click(screen.getByRole("button", { name: "Remove date" }));
    await user.keyboard("{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "dentist tuesday 3pm",
      list_id: 1,
    });
  });

  it("removing the recurrence chip keeps the date but drops recurrence", async () => {
    const api = installFakeApi({
      assistAvailable: true,
      assistParseResult: {
        title: "pay rent",
        due_date: "2026-08-18T00:00:00Z",
        is_all_day: true,
        time_zone: null,
        recurrence: "FREQ=MONTHLY;BYMONTHDAY=1",
        reminders: [],
        list_name: null,
        tag_names: [],
        priority: null,
      },
    });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await screen.findByLabelText("Assist available");
    await user.type(input, "pay rent every month on the 1st{Enter}");
    await screen.findByRole("group", { name: "Assisted Capture draft" });

    await user.click(screen.getByRole("button", { name: "Remove recurrence" }));
    await user.keyboard("{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "pay rent every month on the 1st",
      list_id: 1,
      due_date: "2026-08-18T00:00:00Z",
      is_all_day: true,
    });
  });

  it("removing a tag chip drops only that tag, keeping the list and priority chips", async () => {
    const errands = fakeList("Errands");
    const urgent = fakeTag("Urgent");
    const api = installFakeApi({
      lists: [INBOX, errands],
      tags: [urgent],
      assistAvailable: true,
      assistParseResult: {
        title: "buy milk",
        due_date: null,
        is_all_day: false,
        time_zone: null,
        recurrence: null,
        reminders: [],
        list_name: "Errands",
        tag_names: ["Urgent"],
        priority: "high",
      },
    });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await screen.findByLabelText("Assist available");
    await user.type(input, "buy milk in my errands list urgent high priority{Enter}");
    await screen.findByRole("group", { name: "Assisted Capture draft" });

    await user.click(screen.getByRole("button", { name: "Remove Urgent" }));
    await user.keyboard("{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "buy milk in my errands list urgent high priority",
      list_id: errands.id,
      priority: "high",
    });
  });

  it("removing the reminder chip drops it from the payload, leaving the date intact", async () => {
    const api = installFakeApi({
      assistAvailable: true,
      assistParseResult: {
        title: "dentist",
        due_date: "2026-08-18T15:00:00-04:00",
        is_all_day: false,
        time_zone: "America/New_York",
        recurrence: null,
        reminders: ["-P1D"],
        list_name: null,
        tag_names: [],
        priority: null,
      },
    });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await screen.findByLabelText("Assist available");
    await user.type(input, "dentist tuesday 3pm remind me the day before{Enter}");
    await screen.findByRole("group", { name: "Assisted Capture draft" });

    await user.click(screen.getByRole("button", { name: "Remove reminder (1 day before)" }));
    await user.keyboard("{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "dentist tuesday 3pm remind me the day before",
      list_id: 1,
      due_date: "2026-08-18T15:00:00-04:00",
      is_all_day: false,
      time_zone: "America/New_York",
    });
  });

  it("removing the list chip files under the default List instead", async () => {
    const errands = fakeList("Errands");
    const api = installFakeApi({
      lists: [INBOX, errands],
      assistAvailable: true,
      assistParseResult: {
        title: "buy milk",
        due_date: null,
        is_all_day: false,
        time_zone: null,
        recurrence: null,
        reminders: [],
        list_name: "Errands",
        tag_names: [],
        priority: null,
      },
    });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await screen.findByLabelText("Assist available");
    await user.type(input, "buy milk in my errands list{Enter}");
    await screen.findByRole("group", { name: "Assisted Capture draft" });

    await user.click(screen.getByRole("button", { name: "Remove list" }));
    await user.keyboard("{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "buy milk in my errands list",
      list_id: 1,
    });
  });

  it("supports the full flow keyboard-only: focus a chip's remove button by Tab, remove it, then confirm — focus returns to the draft row automatically", async () => {
    const errands = fakeList("Errands");
    const urgent = fakeTag("Urgent");
    const api = installFakeApi({
      lists: [INBOX, errands],
      tags: [urgent],
      assistAvailable: true,
      assistParseResult: {
        title: "buy milk",
        due_date: "2026-08-18T15:00:00-04:00",
        is_all_day: false,
        time_zone: "America/New_York",
        recurrence: null,
        reminders: [],
        list_name: "Errands",
        tag_names: ["Urgent"],
        priority: "high",
      },
    });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await screen.findByLabelText("Assist available");
    await user.type(input, "buy milk tuesday in my errands list urgent high priority{Enter}");
    await screen.findByRole("group", { name: "Assisted Capture draft" });

    // Tab moves focus through every removable chip in order.
    await user.tab();
    expect(screen.getByRole("button", { name: "Remove date" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Remove list" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Remove Urgent" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Remove priority" })).toHaveFocus();

    // Removing the date chip with the keyboard doesn't confirm the draft —
    // it activates the focused remove button, and focus returns to the
    // draft row so a following Enter confirms rather than needing a
    // separate click or manual refocus.
    await user.tab({ shift: true });
    await user.tab({ shift: true });
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Remove date" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("button", { name: "Remove date" })).not.toBeInTheDocument();

    await user.keyboard("{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "buy milk tuesday in my errands list urgent high priority",
      list_id: errands.id,
      priority: "high",
      tag_ids: [urgent.id],
    });
  });

  it("discarding after a chip removal still saves the task exactly as typed", async () => {
    const api = installFakeApi({
      assistAvailable: true,
      assistParseResult: {
        title: "dentist",
        due_date: "2026-08-18T15:00:00-04:00",
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
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await screen.findByLabelText("Assist available");
    await user.type(input, "dentist tuesday 3pm{Enter}");
    await screen.findByRole("group", { name: "Assisted Capture draft" });

    await user.click(screen.getByRole("button", { name: "Remove date" }));
    await user.keyboard("{Escape}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "dentist tuesday 3pm",
      list_id: 1,
    });
  });
});
