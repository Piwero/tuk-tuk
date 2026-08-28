import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeList, fakeTag, installFakeApi } from "./test/fakeApi";

afterEach(() => {
  vi.restoreAllMocks();
});

function openPalette(): void {
  fireEvent.keyDown(document, { key: "k", metaKey: true });
}

async function seed() {
  const api = installFakeApi({
    lists: [fakeList("Errands", { id: 10 }), fakeList("Reading", { id: 11 })],
    tags: [fakeTag("urgent", { id: 30 })],
    tasks: [],
  });
  render(<App />);
  await screen.findByRole("navigation", { name: "Views" });
  return api;
}

function taskPosts(api: Awaited<ReturnType<typeof seed>>) {
  return api.requests
    .filter((r) => r.method === "POST" && r.url === "/api/v1/tasks")
    .map((r) => r.body);
}

function tagPosts(api: Awaited<ReturnType<typeof seed>>) {
  return api.requests.filter((r) => r.method === "POST" && r.url === "/api/v1/tags");
}

/** Opens the palette and types `query` straight into its field — which is
 * the Task-capture bar itself (issue #204 follow-up): #tag / ~list /
 * !priority parse inline, and Enter on the "New task" row (index 0, active
 * by default) commits. All keyboard, no pointer. */
async function enterCapture(user: ReturnType<typeof userEvent.setup>, query: string) {
  openPalette();
  const dialog = await screen.findByRole("dialog", { name: "Command palette" });
  const input = within(dialog).getByRole("combobox", {
    name: "Search views and Tasks, or type a new Task",
  });
  await user.click(input);
  await user.type(input, query);
  return input;
}

describe("command palette — capture a Task", () => {
  it("creates a Task with the keyboard alone and shows it without a refetch", async () => {
    const api = await seed();
    const user = userEvent.setup();
    fireEvent.click(await screen.findByRole("button", { name: "Errands" }));

    await enterCapture(user, "Buy milk");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(taskPosts(api)).toHaveLength(1));
    expect(taskPosts(api)[0]).toEqual({ title: "Buy milk", list_id: 10 });
    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
    expect(await screen.findByText("Buy milk")).toBeInTheDocument();
  });

  it("parses the !priority sigil exactly as the capture bar does", async () => {
    const api = await seed();
    const user = userEvent.setup();

    await enterCapture(user, "Ship it !high");
    const preview = screen.getByRole("group", { name: "New task" });
    expect(within(preview).getByText("Ship it")).toBeInTheDocument();
    expect(within(preview).getByText("High")).toBeInTheDocument();

    await user.keyboard("{Enter}");
    await waitFor(() => expect(taskPosts(api)).toHaveLength(1));
    expect(taskPosts(api)[0]).toEqual({ title: "Ship it", list_id: 10, priority: "high" });
  });

  it("parses the ~list sigil and files the Task in that List", async () => {
    const api = await seed();
    const user = userEvent.setup();

    await enterCapture(user, "Return book ~Reading");
    const preview = screen.getByRole("group", { name: "New task" });
    expect(within(preview).getByText("Reading")).toBeInTheDocument();

    await user.keyboard("{Enter}");
    await waitFor(() => expect(taskPosts(api)).toHaveLength(1));
    expect(taskPosts(api)[0]).toEqual({ title: "Return book", list_id: 11 });
  });

  it("attaches a #tag that matches an existing Tag", async () => {
    const api = await seed();
    const user = userEvent.setup();

    await enterCapture(user, "Pay rent #urgent");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(taskPosts(api)).toHaveLength(1));
    expect(taskPosts(api)[0]).toEqual({ title: "Pay rent", list_id: 10, tag_ids: [30] });
    expect(tagPosts(api)).toHaveLength(0);
  });

  it("an unpicked #tag token creates nothing and is left off the Task", async () => {
    const api = await seed();
    const user = userEvent.setup();

    await enterCapture(user, "Plan trip #jpn");
    const preview = screen.getByRole("group", { name: "New task" });
    expect(within(preview).getByText("#jpn")).toBeInTheDocument();

    await user.keyboard("{Enter}");
    await waitFor(() => expect(taskPosts(api)).toHaveLength(1));
    expect(taskPosts(api)[0]).toEqual({ title: "Plan trip", list_id: 10 });
    expect(tagPosts(api)).toHaveLength(0);
  });

  it("an unpicked ~list token creates no List and stays in the title", async () => {
    const api = await seed();
    const user = userEvent.setup();

    await enterCapture(user, "Sort stuff ~someday");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(taskPosts(api)).toHaveLength(1));
    expect(taskPosts(api)[0]).toEqual({ title: "Sort stuff ~someday", list_id: 10 });
    expect(
      api.requests.filter((r) => r.method === "POST" && r.url === "/api/v1/lists"),
    ).toHaveLength(0);
  });

  it("suggests matching Lists inline as ~ is typed, right in the palette field", async () => {
    const api = await seed();
    const user = userEvent.setup();

    const input = await enterCapture(user, "Return book ~Rea");
    // The ~list dropdown opens in the palette's own field — no extra step.
    await user.keyboard("{ArrowDown}{Enter}");
    expect(input).toHaveValue("Return book ");

    await user.keyboard("{Enter}");
    await waitFor(() => expect(taskPosts(api)).toHaveLength(1));
    expect(taskPosts(api)[0]).toEqual({ title: "Return book", list_id: 11 });
  });

  it("arrowing the sigil dropdown never moves the palette's own selection", async () => {
    await seed();
    const user = userEvent.setup();

    await enterCapture(user, "urg #urg");
    // ArrowDown belongs to the #tag dropdown here; the "New task" row must
    // stay the active palette row so Enter still commits.
    await user.keyboard("{ArrowDown}{Enter}");

    // The tag chip was picked (dropdown consumed the keys), not a jump target.
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
  });

  it("the Create row is the only way capture brings a new Tag into being", async () => {
    const api = await seed();
    const user = userEvent.setup();

    const input = await enterCapture(user, "Read docs #newtag");
    await screen.findByRole("option", { name: 'Create tag "newtag"' });
    await user.keyboard("{ArrowDown}{Enter}");
    expect(input).toHaveValue("Read docs ");

    expect(tagPosts(api)).toHaveLength(1);
    expect(tagPosts(api)[0]?.body).toEqual({ name: "newtag" });

    await user.keyboard("{Enter}");
    await waitFor(() => expect(taskPosts(api)).toHaveLength(1));
    const created = api.tags.find((tag) => tag.name === "newtag");
    expect(taskPosts(api)[0]).toEqual({
      title: "Read docs",
      list_id: 10,
      tag_ids: [created?.id],
    });
  });
});
