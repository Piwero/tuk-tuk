import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeList, fakeTag, INBOX, installFakeApi, type RecordedRequest } from "./test/fakeApi";

afterEach(() => {
  vi.restoreAllMocks();
});

const taskPosts = (requests: RecordedRequest[]): unknown[] =>
  requests.filter((r) => r.method === "POST" && r.url === "/api/v1/tasks").map((r) => r.body);

async function openFromInbox(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(await screen.findByRole("link", { name: "Inbox" }));
  await user.click(screen.getByRole("button", { name: "Quick add" }));
  return screen.findByRole("dialog", { name: "Quick add" });
}

describe("Quick add dialog — title-first capture (#540)", () => {
  it("opens with only the title, the Inbox destination and Add task; a title alone saves to the Inbox", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    const dialog = await openFromInbox(user);

    expect(screen.getByLabelText("Title")).toHaveFocus();
    const details = within(dialog).getByRole("button", { name: "Details" });
    expect(details).toHaveAttribute("aria-expanded", "false");
    // The field controls wait behind the disclosure.
    expect(within(dialog).queryByRole("combobox", { name: "List" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox", { name: "Priority" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("group", { name: "Date" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("group", { name: "Tags" })).not.toBeInTheDocument();
    // The quiet destination says where a bare title goes.
    const summary = within(dialog).getByRole("group", { name: "Summary" });
    expect(within(summary).getByText("Inbox")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Title"), "Buy milk");
    await user.click(within(dialog).getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({ title: "Buy milk", list_id: INBOX.id });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("shows the viewed List as removable context and files the task there", async () => {
    const errands = fakeList("Errands");
    const api = installFakeApi({ lists: [INBOX, errands] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "Errands" }));
    await user.click(screen.getByRole("button", { name: "Quick add" }));
    const dialog = await screen.findByRole("dialog", { name: "Quick add" });

    const summary = within(dialog).getByRole("group", { name: "Summary" });
    expect(within(summary).getByText("Errands")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Title"), "Post parcel");
    await user.click(within(dialog).getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({ title: "Post parcel", list_id: errands.id });
  });

  it("removing the viewed List's chip sends the task to the Inbox instead", async () => {
    const errands = fakeList("Errands");
    const api = installFakeApi({ lists: [INBOX, errands] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "Errands" }));
    await user.click(screen.getByRole("button", { name: "Quick add" }));
    const dialog = await screen.findByRole("dialog", { name: "Quick add" });

    await user.type(screen.getByLabelText("Title"), "Post parcel");
    await user.click(within(dialog).getByRole("button", { name: "Remove list (Errands)" }));
    const summary = within(dialog).getByRole("group", { name: "Summary" });
    expect(within(summary).queryByText("Errands")).not.toBeInTheDocument();
    expect(within(summary).getByText("Inbox")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({ title: "Post parcel", list_id: INBOX.id });
  });

  it("shows ~list, !priority and #tag picks as chips while collapsed, each removable", async () => {
    const expenses = fakeList("expenses");
    const work = fakeTag("work");
    const home = fakeTag("home");
    const api = installFakeApi({ lists: [INBOX, expenses], tags: [work, home] });
    const user = userEvent.setup();
    render(<App />);
    const dialog = await openFromInbox(user);
    const title = screen.getByRole("combobox", { name: "Title" });

    await user.type(title, "Pay invoice ~expen");
    await user.keyboard("{ArrowDown}{Enter}");
    await user.type(title, "!hi");
    await user.keyboard("{ArrowDown}{Enter}");
    await user.type(title, "#wo");
    await user.keyboard("{ArrowDown}{Enter}");
    await user.type(title, "#ho");
    await user.keyboard("{ArrowDown}{Enter}");

    // Still collapsed, yet every pick is on show.
    expect(within(dialog).getByRole("button", { name: "Details" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    const summary = within(dialog).getByRole("group", { name: "Summary" });
    expect(within(summary).getByText("expenses")).toBeInTheDocument();
    expect(within(summary).getByText("High priority")).toBeInTheDocument();
    expect(within(summary).getByText("#work")).toBeInTheDocument();
    expect(within(summary).getByText("#home")).toBeInTheDocument();
    expect(title).toHaveValue("Pay invoice ");

    await user.click(within(summary).getByRole("button", { name: "Remove list (expenses)" }));
    await user.click(within(summary).getByRole("button", { name: "Remove priority (High)" }));
    await user.click(within(summary).getByRole("button", { name: "Remove tag (home)" }));
    expect(within(summary).queryByText("expenses")).not.toBeInTheDocument();
    expect(within(summary).queryByText("High priority")).not.toBeInTheDocument();
    expect(within(summary).queryByText("#home")).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Add task" }));
    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "Pay invoice",
      list_id: INBOX.id,
      tag_ids: [work.id],
    });
  });

  it("shows an @day pick as a removable date chip while collapsed", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    const dialog = await openFromInbox(user);
    const title = screen.getByRole("combobox", { name: "Title" });

    await user.type(title, "Water plants @tomorrow");
    await user.keyboard("{ArrowDown}{Enter}");
    const summary = within(dialog).getByRole("group", { name: "Summary" });
    expect(within(summary).getByText("Tomorrow")).toBeInTheDocument();

    await user.click(within(summary).getByRole("button", { name: "Remove date (Tomorrow)" }));
    expect(within(summary).queryByText("Tomorrow")).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Add task" }));
    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({ title: "Water plants", list_id: INBOX.id });
  });

  it("keeps the title and every pick across expanding and collapsing Details, then saves on Enter", async () => {
    const errands = fakeList("Errands");
    const api = installFakeApi({ lists: [INBOX, errands] });
    const user = userEvent.setup();
    render(<App />);
    const dialog = await openFromInbox(user);
    const title = screen.getByRole("combobox", { name: "Title" });

    await user.type(title, "Renew passport !hi");
    await user.keyboard("{ArrowDown}{Enter}");
    const details = within(dialog).getByRole("button", { name: "Details" });
    await user.click(details);

    expect(details).toHaveAttribute("aria-expanded", "true");
    expect(within(dialog).getByRole("combobox", { name: "Priority" })).toHaveValue("high");
    expect(title).toHaveValue("Renew passport ");
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "List" }),
      String(errands.id),
    );

    await user.click(details);
    expect(details).toHaveAttribute("aria-expanded", "false");
    expect(within(dialog).queryByRole("combobox", { name: "List" })).not.toBeInTheDocument();
    const summary = within(dialog).getByRole("group", { name: "Summary" });
    expect(within(summary).getByText("Errands")).toBeInTheDocument();
    expect(within(summary).getByText("High priority")).toBeInTheDocument();
    expect(title).toHaveValue("Renew passport ");

    await user.click(title);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "Renew passport",
      list_id: errands.id,
      priority: "high",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("opens Details on an applied Assisted Capture parse, so the confirmation beat shows what changed", async () => {
    const errands = fakeList("Errands");
    const api = installFakeApi({
      lists: [INBOX, errands],
      assistAvailable: true,
      assistParseResult: {
        title: "pay rent",
        due_date: "2026-08-18T00:00:00Z",
        is_all_day: true,
        time_zone: null,
        recurrence: "FREQ=MONTHLY;BYMONTHDAY=1",
        reminders: [],
        list_name: "Errands",
        tag_names: [],
        priority: null,
      },
    });
    const user = userEvent.setup();
    render(<App />);
    const dialog = await openFromInbox(user);

    await user.type(screen.getByLabelText("Title"), "pay rent monthly in errands");
    await within(dialog).findByLabelText("Assist available");
    await user.click(within(dialog).getByRole("button", { name: "Add task" }));

    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Details" })).toHaveAttribute(
        "aria-expanded",
        "true",
      ),
    );
    expect(within(dialog).getByRole("combobox", { name: "List" })).toHaveValue(String(errands.id));
    const summary = within(dialog).getByRole("group", { name: "Summary" });
    expect(within(summary).getByText("Errands")).toBeInTheDocument();
    expect(within(summary).getByText("Aug 18")).toBeInTheDocument();
    expect(within(summary).getByText("monthly on the 1st")).toBeInTheDocument();
    expect(taskPosts(api.requests)).toHaveLength(0);

    await user.click(within(dialog).getByRole("button", { name: "Add task" }));
    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toMatchObject({ title: "pay rent", list_id: errands.id });
  });

  it("still saves a bare title in one click while collapsed when the Assist parse fails", async () => {
    const api = installFakeApi({ assistAvailable: true, assistParseFails: true });
    const user = userEvent.setup();
    render(<App />);
    const dialog = await openFromInbox(user);

    await user.type(screen.getByLabelText("Title"), "dentist tuesday 3pm");
    await within(dialog).findByLabelText("Assist available");
    await user.click(within(dialog).getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({ title: "dentist tuesday 3pm", list_id: INBOX.id });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
