import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { browserTimeZone } from "./dates";
import { fakeList, fakeTag, INBOX, installFakeApi } from "./test/fakeApi";

// Note: fetch stays stubbed across tests (each test installs a fresh fake).
// Restoring the real fetch between tests would let a late in-flight request
// from an unmounting App escape to the network and fail the run.

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Quick add dialog", () => {
  it("opens from the sidebar, directly below the search box", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Inbox" });

    const sidebar = screen.getByRole("complementary");
    const trigger = within(sidebar).getByRole("button", { name: "Quick add" });
    expect(within(sidebar).getByRole("search").nextElementSibling).toBe(trigger);

    await user.click(trigger);

    expect(await screen.findByRole("dialog", { name: "Quick add" })).toBeInTheDocument();
  });

  it("stays reachable on the Habits screen, which has no task header", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    const views = await screen.findByRole("navigation", { name: "Views" });
    await user.click(within(views).getByRole("button", { name: "Habits" }));
    await screen.findByRole("heading", { name: "Habits" });

    await user.click(screen.getByRole("button", { name: "Quick add" }));

    expect(await screen.findByRole("dialog", { name: "Quick add" })).toBeInTheDocument();
  });

  it("dismisses on Escape and on the close button, creating nothing", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Inbox" });

    await user.click(screen.getByRole("button", { name: "Quick add" }));
    await screen.findByRole("dialog", { name: "Quick add" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Quick add" }));
    await screen.findByRole("dialog", { name: "Quick add" });
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    expect(api.requests.filter((r) => r.method === "POST")).toHaveLength(0);
  });

  it("creates a task with a title into the viewed List and closes", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Inbox" });

    await user.click(screen.getByRole("button", { name: "Quick add" }));
    await user.type(await screen.findByLabelText("Title"), "Buy milk");
    await user.click(screen.getByRole("button", { name: "Add task" }));

    expect(await screen.findByText("Buy milk")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const posts = api.requests.filter((r) => r.method === "POST" && r.url === "/api/v1/tasks");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual({ title: "Buy milk", list_id: INBOX.id });
  });

  it("files the task into a chosen List with a priority, and keeps it out of the current view", async () => {
    const errands = fakeList("Errands");
    const api = installFakeApi({ lists: [INBOX, errands] });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Inbox" });

    await user.click(screen.getByRole("button", { name: "Quick add" }));
    await user.type(await screen.findByLabelText("Title"), "Print badge");
    await user.selectOptions(screen.getByLabelText("List"), String(errands.id));
    await user.selectOptions(screen.getByLabelText("Priority"), "high");
    await user.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const post = api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/tasks");
    expect(post?.body).toEqual({
      title: "Print badge",
      list_id: errands.id,
      priority: "high",
    });
    // The Inbox is on screen; the task went to Errands.
    expect(screen.queryByText("Print badge")).not.toBeInTheDocument();
  });

  it("applies existing Tags and creates a new one on the way", async () => {
    const work = fakeTag("work");
    const api = installFakeApi({ tags: [work] });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Inbox" });

    await user.click(screen.getByRole("button", { name: "Quick add" }));
    await user.type(await screen.findByLabelText("Title"), "Email boss");
    await user.click(screen.getByRole("checkbox", { name: "work" }));
    await user.type(screen.getByLabelText("New tag"), "urgent");
    await user.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const tagPost = api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/tags");
    expect(tagPost?.body).toEqual({ name: "urgent" });
    const created = api.tags.find((tag) => tag.name === "urgent");
    const taskPost = api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/tasks");
    expect(taskPost?.body).toEqual({
      title: "Email boss",
      list_id: INBOX.id,
      tag_ids: [work.id, created?.id],
    });
    // The new Tag is navigable straight away.
    const nav = screen.getByRole("navigation", { name: "Tags" });
    expect(within(nav).getByRole("button", { name: "urgent" })).toBeInTheDocument();
  });

  it("schedules a timed start+due on one day", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Inbox" });

    await user.click(screen.getByRole("button", { name: "Quick add" }));
    await user.type(await screen.findByLabelText("Title"), "Design review");
    fireEvent.change(screen.getByLabelText("Day"), { target: { value: "2026-07-10" } });
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "14:00" } });
    fireEvent.change(screen.getByLabelText("Due time"), { target: { value: "15:30" } });
    await user.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const post = api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/tasks");
    expect(post?.body).toEqual({
      title: "Design review",
      list_id: INBOX.id,
      start_date: new Date(2026, 6, 10, 14, 0).toISOString(),
      due_date: new Date(2026, 6, 10, 15, 30).toISOString(),
      is_all_day: false,
      time_zone: browserTimeZone(),
    });
  });

  it("schedules an all-day span from the quick picks and the day inputs", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Inbox" });

    await user.click(screen.getByRole("button", { name: "Quick add" }));
    await user.type(await screen.findByLabelText("Title"), "Conference");
    await user.click(screen.getByRole("button", { name: "Tomorrow" }));
    // The quick pick fills the day; the span is then widened by hand.
    await user.click(screen.getByRole("checkbox", { name: "All day" }));
    fireEvent.change(screen.getByLabelText("Start day"), { target: { value: "2026-07-06" } });
    fireEvent.change(screen.getByLabelText("Due day"), { target: { value: "2026-07-08" } });
    await user.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const post = api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/tasks");
    expect(post?.body).toEqual({
      title: "Conference",
      list_id: INBOX.id,
      start_date: "2026-07-06T00:00:00Z",
      due_date: "2026-07-08T00:00:00Z",
      is_all_day: true,
      time_zone: browserTimeZone(),
    });
  });

  it("takes back a quick pick with Clear date", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Inbox" });

    await user.click(screen.getByRole("button", { name: "Quick add" }));
    await user.type(await screen.findByLabelText("Title"), "Someday"); // no date
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Today" }));
    await user.click(within(dialog).getByRole("button", { name: "Clear date" }));
    await user.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const post = api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/tasks");
    expect(post?.body).toEqual({ title: "Someday", list_id: INBOX.id });
  });

  it("shows a task created from a Smart List once the view recomputes", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    const nav = await screen.findByRole("navigation", { name: "Smart Lists" });
    await user.click(within(nav).getByRole("button", { name: "Today" }));
    await screen.findByRole("heading", { name: "Today" });

    await user.click(screen.getByRole("button", { name: "Quick add" }));
    await user.type(await screen.findByLabelText("Title"), "Call plumber");
    // The dialog's own Today quick pick, not the sidebar's Smart List.
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Today" }));
    await user.click(screen.getByRole("button", { name: "Add task" }));

    expect(await screen.findByText("Call plumber")).toBeInTheDocument();
    const post = api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/tasks");
    expect(post?.body).toMatchObject({ title: "Call plumber", is_all_day: true });
  });

  it("puts focus in the title, keeps Tab inside, and hands it back on close", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Inbox" });

    const trigger = screen.getByRole("button", { name: "Quick add" });
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Quick add" });
    expect(screen.getByLabelText("Title")).toHaveFocus();

    // Tabbing off the last control wraps back into the dialog, never behind it.
    screen.getByRole("button", { name: "Add task" }).focus();
    await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("does not submit an empty title", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Inbox" });

    await user.click(screen.getByRole("button", { name: "Quick add" }));
    await user.type(await screen.findByLabelText("Title"), "   ");
    await user.click(screen.getByRole("button", { name: "Add task" }));

    expect(screen.getByRole("dialog", { name: "Quick add" })).toBeInTheDocument();
    expect(api.requests.filter((r) => r.method === "POST")).toHaveLength(0);
  });
});
