import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { type AssistCaptureDraft } from "./api";
import { browserTimeZone } from "./dates";
import { fakeList, fakeTag, INBOX, installFakeApi, type RecordedRequest } from "./test/fakeApi";

afterEach(() => {
  vi.restoreAllMocks();
});

const taskPosts = (requests: RecordedRequest[]): unknown[] =>
  requests.filter((r) => r.method === "POST" && r.url === "/api/v1/tasks").map((r) => r.body);

const parsePosts = (requests: RecordedRequest[]): unknown[] =>
  requests
    .filter((r) => r.method === "POST" && r.url === "/api/v1/assist/parse-capture")
    .map((r) => r.body);

const draft = (overrides: Partial<AssistCaptureDraft>): AssistCaptureDraft => ({
  title: "get repaired watch",
  due_date: "2026-08-27T18:00:00Z",
  is_all_day: false,
  time_zone: "UTC",
  recurrence: null,
  reminders: [],
  list_name: null,
  tag_names: [],
  priority: null,
  ...overrides,
});

async function openDialog(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(await screen.findByRole("button", { name: "Inbox" }));
  await user.click(screen.getByRole("button", { name: "Quick add" }));
  return screen.findByRole("dialog", { name: "Quick add" });
}

describe("Quick add dialog — Assisted Capture (ADR 0005)", () => {
  it("parses the title into the dialog's own fields on the first Add task, saving nothing until a second", async () => {
    const api = installFakeApi({ assistAvailable: true, assistParseResult: draft({}) });
    const user = userEvent.setup();
    render(<App />);
    const dialog = await openDialog(user);

    await user.type(screen.getByLabelText("Title"), "get repaired watch today at 18.00");
    await within(dialog).findByLabelText("Assist available");
    await user.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(parsePosts(api.requests)).toHaveLength(1));
    expect(parsePosts(api.requests)[0]).toMatchObject({
      text: "get repaired watch today at 18.00",
    });

    // Nothing saved yet; the dialog stays open with the parse applied to its
    // own controls — the recognised phrase gone from the title.
    expect(taskPosts(api.requests)).toHaveLength(0);
    expect(screen.getByRole("dialog", { name: "Quick add" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("get repaired watch"));
    expect(screen.getByLabelText("Day")).toHaveValue("2026-08-27");
    expect(screen.getByLabelText("Due time")).toHaveValue("18:00");

    await user.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "get repaired watch",
      list_id: INBOX.id,
      due_date: new Date(2026, 7, 27, 18, 0).toISOString(),
      is_all_day: false,
      time_zone: browserTimeZone(),
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // Exactly one parse for the whole flow.
    expect(parsePosts(api.requests)).toHaveLength(1);
  });

  it("fills the List, Priority and Tags controls from matched suggestions", async () => {
    const errands = fakeList("Errands");
    const urgent = fakeTag("Urgent");
    const api = installFakeApi({
      lists: [INBOX, errands],
      tags: [urgent],
      assistAvailable: true,
      assistParseResult: draft({
        title: "buy milk",
        due_date: null,
        is_all_day: false,
        time_zone: null,
        list_name: "Errands",
        tag_names: ["Urgent"],
        priority: "high",
      }),
    });
    const user = userEvent.setup();
    render(<App />);
    const dialog = await openDialog(user);

    await user.type(screen.getByLabelText("Title"), "buy milk in errands urgent high priority");
    await within(dialog).findByLabelText("Assist available");
    await user.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(screen.getByLabelText("List")).toHaveValue(String(errands.id)));
    expect(screen.getByLabelText("Priority")).toHaveValue("high");
    expect(screen.getByRole("checkbox", { name: "Urgent" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "buy milk",
      list_id: errands.id,
      priority: "high",
      tag_ids: [urgent.id],
    });
  });

  it("renders a removable recurrence chip and confirms it into the created Task", async () => {
    const api = installFakeApi({
      assistAvailable: true,
      assistParseResult: draft({
        title: "pay rent",
        due_date: "2026-08-18T00:00:00Z",
        is_all_day: true,
        time_zone: null,
        recurrence: "FREQ=MONTHLY;BYMONTHDAY=1",
      }),
    });
    const user = userEvent.setup();
    render(<App />);
    const dialog = await openDialog(user);

    await user.type(screen.getByLabelText("Title"), "pay rent every month on the 1st");
    await within(dialog).findByLabelText("Assist available");
    await user.click(screen.getByRole("button", { name: "Add task" }));

    await within(dialog).findByText("monthly on the 1st");

    await user.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "pay rent",
      list_id: INBOX.id,
      due_date: "2026-08-18T00:00:00Z",
      is_all_day: true,
      time_zone: browserTimeZone(),
      recurrence: "FREQ=MONTHLY;BYMONTHDAY=1",
    });
  });

  it("drops the recurrence when its chip is removed before the second Add task", async () => {
    const api = installFakeApi({
      assistAvailable: true,
      assistParseResult: draft({
        title: "pay rent",
        due_date: "2026-08-18T00:00:00Z",
        is_all_day: true,
        time_zone: null,
        recurrence: "FREQ=MONTHLY;BYMONTHDAY=1",
        reminders: ["-P1D"],
      }),
    });
    const user = userEvent.setup();
    render(<App />);
    const dialog = await openDialog(user);

    await user.type(
      screen.getByLabelText("Title"),
      "pay rent every month remind me the day before",
    );
    await within(dialog).findByLabelText("Assist available");
    await user.click(screen.getByRole("button", { name: "Add task" }));

    await within(dialog).findByText("monthly on the 1st");
    await user.click(screen.getByRole("button", { name: "Remove recurrence" }));
    await user.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "pay rent",
      list_id: INBOX.id,
      due_date: "2026-08-18T00:00:00Z",
      is_all_day: true,
      time_zone: browserTimeZone(),
      reminders: ["-P1D"],
    });
  });

  it("saves in one Add task, with no parse, when Assist is unavailable", async () => {
    const api = installFakeApi({ assistAvailable: false });
    const user = userEvent.setup();
    render(<App />);
    const dialog = await openDialog(user);

    expect(within(dialog).queryByLabelText("Assist available")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Title"), "call mom tomorrow");
    await user.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(parsePosts(api.requests)).toHaveLength(0);
    expect(taskPosts(api.requests)[0]).toEqual({ title: "call mom tomorrow", list_id: INBOX.id });
  });

  it("saves in one Add task when the parse extracts nothing to apply", async () => {
    const api = installFakeApi({ assistAvailable: true });
    const user = userEvent.setup();
    render(<App />);
    const dialog = await openDialog(user);

    await user.type(screen.getByLabelText("Title"), "call mom");
    await within(dialog).findByLabelText("Assist available");
    await user.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(parsePosts(api.requests)).toHaveLength(1);
    expect(taskPosts(api.requests)[0]).toEqual({ title: "call mom", list_id: INBOX.id });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("degrades to a plain save, with no error, when the parse request fails", async () => {
    const api = installFakeApi({ assistAvailable: true, assistParseFails: true });
    const user = userEvent.setup();
    render(<App />);
    const dialog = await openDialog(user);

    await user.type(screen.getByLabelText("Title"), "dentist tuesday 3pm");
    await within(dialog).findByLabelText("Assist available");
    await user.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({ title: "dentist tuesday 3pm", list_id: INBOX.id });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("lets the user edit the parsed date before saving it", async () => {
    const api = installFakeApi({ assistAvailable: true, assistParseResult: draft({}) });
    const user = userEvent.setup();
    render(<App />);
    const dialog = await openDialog(user);

    await user.type(screen.getByLabelText("Title"), "get repaired watch today at 18.00");
    await within(dialog).findByLabelText("Assist available");
    await user.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(screen.getByLabelText("Due time")).toHaveValue("18:00"));
    fireEvent.change(screen.getByLabelText("Due time"), { target: { value: "19:30" } });
    await user.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toMatchObject({
      due_date: new Date(2026, 7, 27, 19, 30).toISOString(),
    });
  });

  it("never overwrites a date the user entered by hand, nor a hand-ticked tag", async () => {
    const urgent = fakeTag("Urgent");
    const api = installFakeApi({
      tags: [urgent],
      assistAvailable: true,
      assistParseResult: draft({ title: "get repaired watch", tag_names: ["Urgent"] }),
    });
    const user = userEvent.setup();
    render(<App />);
    const dialog = await openDialog(user);

    await user.type(screen.getByLabelText("Title"), "get repaired watch today at 18.00");
    await within(dialog).findByLabelText("Assist available");
    // The user fills the date themselves before submitting.
    await user.click(within(dialog).getByRole("button", { name: "Tomorrow" }));
    const chosenDay = screen.getByLabelText("Day").getAttribute("value");
    await user.click(screen.getByRole("button", { name: "Add task" }));

    // The parse landed the suggested tag (the user ticked none) but left the
    // hand-entered day untouched — no time from "18.00", no overwrite.
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Urgent" })).toBeChecked());
    expect(screen.getByLabelText("Day")).toHaveValue(chosenDay);
    expect(screen.getByLabelText("Due time")).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "Add task" }));
    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "get repaired watch",
      list_id: INBOX.id,
      tag_ids: [urgent.id],
      due_date: `${chosenDay}T00:00:00Z`,
      is_all_day: true,
      time_zone: browserTimeZone(),
    });
  });
});
