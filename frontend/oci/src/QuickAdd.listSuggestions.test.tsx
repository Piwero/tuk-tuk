import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { fakeList, installFakeApi, INBOX, type RecordedRequest } from "./test/fakeApi";

const taskPosts = (requests: RecordedRequest[]): unknown[] =>
  requests.filter((r) => r.method === "POST" && r.url === "/api/v1/tasks").map((r) => r.body);

describe("Quick-Add ~ suggestion dropdown", () => {
  it("opens on a bare ~ and lists every existing list", async () => {
    const work = fakeList("Work");
    const home = fakeList("Home");
    installFakeApi({ lists: [INBOX, work, home] });
    render(<App />);
    const user = userEvent.setup();

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "~");

    const listbox = await screen.findByRole("listbox");
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Inbox", "Work", "Home"]);
  });

  it("narrows the options by case-insensitive prefix as the query is typed", async () => {
    const work = fakeList("Work");
    const workout = fakeList("Workout");
    installFakeApi({ lists: [INBOX, work, workout] });
    render(<App />);
    const user = userEvent.setup();

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "~WO");

    const listbox = await screen.findByRole("listbox");
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Work", "Workout", 'Create list "WO"']);
  });

  it("finds a multi-word list name by typing only its first word", async () => {
    const errands = fakeList("Personal Errands");
    installFakeApi({ lists: [INBOX, errands] });
    render(<App />);
    const user = userEvent.setup();

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "buy milk ~personal");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(
      await screen.findByRole("button", { name: "Remove Personal Errands" }),
    ).toBeInTheDocument();
    expect(input).toHaveValue("buy milk ");
  });

  it("picking a list removes the token text and shows a single chip; picking another replaces it", async () => {
    const work = fakeList("Work");
    const home = fakeList("Home");
    installFakeApi({ lists: [INBOX, work, home] });
    render(<App />);
    const user = userEvent.setup();

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "read ~wo");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(await screen.findByRole("button", { name: "Remove Work" })).toBeInTheDocument();
    expect(input).toHaveValue("read ");

    await user.type(input, "~ho");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(await screen.findByRole("button", { name: "Remove Home" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Work" })).toBeNull();
  });

  it("files the created task into the chipped list, even when it differs from the viewed list", async () => {
    const work = fakeList("Work");
    const api = installFakeApi({ lists: [INBOX, work] });
    render(<App />);
    const user = userEvent.setup();

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "read ~wo");
    await user.keyboard("{ArrowDown}{Enter}");
    await user.type(input, "{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({ title: "read", list_id: work.id });
    // The viewed list is still the Inbox, so the created task isn't shown there.
    expect(screen.queryByText("read")).toBeNull();
  });
});

describe("Quick-Add ~ dropdown create-list row", () => {
  it("offers to create the query when no list matches it", async () => {
    installFakeApi({ lists: [INBOX] });
    render(<App />);
    const user = userEvent.setup();

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "~zzz");

    expect(await screen.findByRole("option", { name: 'Create list "zzz"' })).toBeInTheDocument();
  });

  it("is absent when the query is empty", async () => {
    installFakeApi({ lists: [INBOX] });
    render(<App />);
    const user = userEvent.setup();

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "~");

    await screen.findByRole("listbox");
    expect(screen.queryByRole("option", { name: /Create list/ })).toBeNull();
  });

  it("picking the row creates a top-level, name-only list and files the task into it", async () => {
    const api = installFakeApi({ lists: [INBOX] });
    render(<App />);
    const user = userEvent.setup();

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "read ~zzz");
    await user.click(await screen.findByRole("option", { name: 'Create list "zzz"' }));

    expect(await screen.findByRole("button", { name: "Remove zzz" })).toBeInTheDocument();
    expect(input).toHaveValue("read ");

    const listPosts = api.requests.filter((r) => r.method === "POST" && r.url === "/api/v1/lists");
    expect(listPosts).toHaveLength(1);
    expect(listPosts[0]?.body).toEqual({ name: "zzz" });

    await user.type(input, "{Enter}");
    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    const created = api.lists.find((list) => list.name === "zzz");
    expect(created).toBeDefined();
    expect(created?.folder_id).toBeNull();
    expect(created?.emoji).toBeNull();
    expect(created?.color).toBeNull();
    expect(taskPosts(api.requests)[0]).toEqual({ title: "read", list_id: created?.id });
  });

  it("appears in the sidebar without a reload once created", async () => {
    installFakeApi({ lists: [INBOX] });
    render(<App />);
    const user = userEvent.setup();

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "~zzz");
    await user.click(await screen.findByRole("option", { name: 'Create list "zzz"' }));

    const nav = screen.getByRole("navigation", { name: "Lists" });
    expect(await within(nav).findByRole("button", { name: "zzz" })).toBeInTheDocument();
  });

  it("a ~foo typed but never picked creates no list and is saved verbatim in the title", async () => {
    const api = installFakeApi({ lists: [INBOX] });
    render(<App />);
    const user = userEvent.setup();

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "read ~foo{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({ title: "read ~foo", list_id: INBOX.id });
    const listPosts = api.requests.filter((r) => r.method === "POST" && r.url === "/api/v1/lists");
    expect(listPosts).toHaveLength(0);
  });

  it("a chipped list wins over a conflicting raw ~token, which stays in the saved title", async () => {
    const personal = fakeList("Personal");
    const work = fakeList("Work");
    const api = installFakeApi({ lists: [INBOX, personal, work] });
    render(<App />);
    const user = userEvent.setup();

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "read ~personal");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(await screen.findByRole("button", { name: "Remove Personal" })).toBeInTheDocument();

    await user.type(input, "~work{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({ title: "read ~work", list_id: personal.id });
  });
});
