import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { fakeTag, installFakeApi, INBOX, type RecordedRequest } from "./test/fakeApi";

const taskPosts = (requests: RecordedRequest[]): unknown[] =>
  requests.filter((r) => r.method === "POST" && r.url === "/api/v1/tasks").map((r) => r.body);

describe("Quick-Add # suggestion dropdown", () => {
  it("opens on a bare # and lists every existing tag", async () => {
    const books = fakeTag("Books");
    const fun = fakeTag("Fun");
    installFakeApi({ tags: [books, fun] });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "#");

    const listbox = await screen.findByRole("listbox");
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Books", "Fun"]);
  });

  it("narrows the options by case-insensitive prefix as the query is typed", async () => {
    const books = fakeTag("Books");
    const boat = fakeTag("Boat");
    const fun = fakeTag("Fun");
    installFakeApi({ tags: [books, boat, fun] });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "#BO");

    const listbox = await screen.findByRole("listbox");
    // The App fetches tags sorted alphabetically, so "Boat" sorts before "Books".
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Boat", "Books", 'Create tag "BO"']);
  });

  it("stays inert when the sigil follows a non-whitespace character", async () => {
    installFakeApi({ tags: [fakeTag("Sharp")] });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "C#");

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes once a space ends the query", async () => {
    installFakeApi({ tags: [fakeTag("Books")] });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "#books ");

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("opens with no row highlighted, so Enter still submits the form", async () => {
    const books = fakeTag("Books");
    const api = installFakeApi({ tags: [books] });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "read #books{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "read",
      list_id: INBOX.id,
      tag_ids: [books.id],
    });
  });

  it("picks the active option with Enter after ArrowDown, replacing the token with a chip", async () => {
    const books = fakeTag("Books");
    const fun = fakeTag("Fun");
    const api = installFakeApi({ tags: [books, fun] });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "read #bo");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(await screen.findByRole("button", { name: "Remove Books" })).toBeInTheDocument();
    expect(input).toHaveValue("read ");

    await user.type(input, "{Enter}");
    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "read",
      list_id: INBOX.id,
      tag_ids: [books.id],
    });
  });

  it("Tab picks the first match", async () => {
    const books = fakeTag("Books");
    const boat = fakeTag("Boat");
    installFakeApi({ tags: [books, boat] });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "#bo");
    await user.tab();

    // Alphabetically, "Boat" is the first match.
    expect(await screen.findByRole("button", { name: "Remove Boat" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Books" })).toBeNull();
  });

  it("Escape releases the highlighted row without closing the dropdown", async () => {
    const books = fakeTag("Books");
    installFakeApi({ tags: [books] });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "read #bo");
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: "Books" })).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Escape}");
    expect(screen.getByRole("option", { name: "Books" })).toHaveAttribute("aria-selected", "false");
    // The dropdown itself stays open — Escape only released the highlight.
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    // Enter now submits the form rather than picking, since nothing is active.
    await user.type(input, "{Enter}");
    await waitFor(() =>
      expect(screen.queryByRole("combobox", { name: "Add a task" })).toHaveValue(""),
    );
  });

  it("removing a chip drops that tag from the created task", async () => {
    const books = fakeTag("Books");
    const api = installFakeApi({ tags: [books] });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "read #bo");
    await user.keyboard("{ArrowDown}{Enter}");
    await user.click(await screen.findByRole("button", { name: "Remove Books" }));
    await user.type(input, "{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({ title: "read", list_id: INBOX.id });
  });

  it("unions a picked chip with a raw #token typed afterwards, deduplicated case-insensitively", async () => {
    const books = fakeTag("Books");
    const api = installFakeApi({ tags: [books] });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "read #bo");
    await user.keyboard("{ArrowDown}{Enter}");
    // Chip for Books is now set aside; typing a second, differently-cased
    // #books token must not duplicate it, but #fun should still be created.
    await user.type(input, "#BOOKS #fun{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    const fun = api.tags.find((tag) => tag.name === "fun");
    expect(fun).toBeDefined();
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "read",
      list_id: INBOX.id,
      tag_ids: [books.id, fun?.id],
    });
  });
});

describe("Quick-Add # dropdown create-tag row", () => {
  it("offers to create the query when no tag matches it", async () => {
    installFakeApi({ tags: [fakeTag("Books")] });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "#zzz");

    expect(await screen.findByRole("option", { name: 'Create tag "zzz"' })).toBeInTheDocument();
  });

  it("is absent when the query is empty", async () => {
    installFakeApi({ tags: [fakeTag("Books")] });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "#");

    await screen.findByRole("listbox");
    expect(screen.queryByRole("option", { name: /Create tag/ })).toBeNull();
  });

  it("is absent when an existing tag matches the query exactly, case-insensitively", async () => {
    installFakeApi({ tags: [fakeTag("Books")] });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "#BOOKS");

    await screen.findByRole("option", { name: "Books" });
    expect(screen.queryByRole("option", { name: /Create tag/ })).toBeNull();
  });

  it("picking the row creates a name-only tag, chips it, and attaches it to the created task", async () => {
    const api = installFakeApi({ tags: [] });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "read #zzz");
    await user.click(await screen.findByRole("option", { name: 'Create tag "zzz"' }));

    expect(await screen.findByRole("button", { name: "Remove zzz" })).toBeInTheDocument();
    expect(input).toHaveValue("read ");

    const tagPosts = api.requests.filter((r) => r.method === "POST" && r.url === "/api/v1/tags");
    expect(tagPosts).toHaveLength(1);
    expect(tagPosts[0]?.body).toEqual({ name: "zzz" });

    await user.type(input, "{Enter}");
    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    const created = api.tags.find((tag) => tag.name === "zzz");
    expect(created).toBeDefined();
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "read",
      list_id: INBOX.id,
      tag_ids: [created?.id],
    });
  });

  it("Tab completes an existing match rather than picking the create row", async () => {
    const boat = fakeTag("Boat");
    const api = installFakeApi({ tags: [boat] });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "#bo");
    await screen.findByRole("option", { name: 'Create tag "bo"' });
    await user.tab();

    expect(await screen.findByRole("button", { name: "Remove Boat" })).toBeInTheDocument();
    const tagPosts = api.requests.filter((r) => r.method === "POST" && r.url === "/api/v1/tags");
    expect(tagPosts).toHaveLength(0);
  });

  it("Tab does nothing when only the create row is offered", async () => {
    const api = installFakeApi({ tags: [] });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "#zzz");
    await screen.findByRole("option", { name: 'Create tag "zzz"' });
    await user.tab();

    expect(input).toHaveValue("#zzz");
    const tagPosts = api.requests.filter((r) => r.method === "POST" && r.url === "/api/v1/tags");
    expect(tagPosts).toHaveLength(0);
  });

  it("makes the newly created tag available in the dropdown on a subsequent #, without a reload", async () => {
    installFakeApi({ tags: [] });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "#zzz");
    await user.click(await screen.findByRole("option", { name: 'Create tag "zzz"' }));
    await user.type(input, "{Enter}");
    await waitFor(() => expect(input).toHaveValue(""));

    await user.type(input, "#");
    expect(await screen.findByRole("option", { name: "zzz" })).toBeInTheDocument();
  });
});
