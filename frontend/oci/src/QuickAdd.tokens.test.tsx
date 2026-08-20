import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { fakeList, fakeTag, INBOX, installFakeApi, type RecordedRequest } from "./test/fakeApi";

// Note: fetch stays stubbed across tests (each test installs a fresh fake).

async function quickAdd(text: string): Promise<void> {
  const user = userEvent.setup();
  const input = await screen.findByRole("combobox", { name: "Add a task" });
  await user.type(input, `${text}{Enter}`);
}

const taskPosts = (requests: RecordedRequest[]): unknown[] =>
  requests.filter((r) => r.method === "POST" && r.url === "/api/v1/tasks").map((r) => r.body);

describe("Quick-Add tokens", () => {
  it("parses #tag, !priority and ~list into structured fields", async () => {
    const personal = fakeList("Personal");
    const api = installFakeApi({ lists: [INBOX, personal] });
    render(<App />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Inbox" }));

    await quickAdd("pay rent #finance !high ~Personal");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    const finance = api.tags.find((tag) => tag.name === "finance");
    expect(finance).toBeDefined();
    expect(
      api.requests.some(
        (r) =>
          r.method === "POST" &&
          r.url === "/api/v1/tags" &&
          JSON.stringify(r.body) === JSON.stringify({ name: "finance" }),
      ),
    ).toBe(true);
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "pay rent",
      list_id: personal.id,
      priority: "high",
      tag_ids: [finance?.id],
    });
    // The task was filed into Personal, so the viewed Inbox must not show it.
    expect(screen.queryByRole("button", { name: "Open details for pay rent" })).toBeNull();
  });

  it("applies every #tag, creating only the unknown ones", async () => {
    const books = fakeTag("Books");
    const api = installFakeApi({ tags: [books] });
    render(<App />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Inbox" }));

    await quickAdd("read #books #fun");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    const tagPosts = api.requests.filter((r) => r.method === "POST" && r.url === "/api/v1/tags");
    expect(tagPosts.map((r) => r.body)).toEqual([{ name: "fun" }]);
    const fun = api.tags.find((tag) => tag.name === "fun");
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "read",
      list_id: INBOX.id,
      tag_ids: [books.id, fun?.id],
    });
    expect(
      await screen.findByRole("button", { name: "Open details for read" }),
    ).toBeInTheDocument();
  });

  it("leaves an unmatched ~list token in the title verbatim", async () => {
    const api = installFakeApi();
    render(<App />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Inbox" }));

    await quickAdd("call mom ~Family");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "call mom ~Family",
      list_id: INBOX.id,
    });
  });

  it("consumes only the first matched ~list; later ones stay verbatim", async () => {
    const personal = fakeList("Personal");
    const work = fakeList("Work");
    const api = installFakeApi({ lists: [INBOX, personal, work] });
    render(<App />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Inbox" }));

    await quickAdd("buy milk ~Personal ~Work");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "buy milk ~Work",
      list_id: personal.id,
    });
  });

  it("leaves an unknown !priority token in the title verbatim", async () => {
    const api = installFakeApi();
    render(<App />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Inbox" }));

    await quickAdd("ship it !urgent");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "ship it !urgent",
      list_id: INBOX.id,
    });
  });

  it("creates nothing when only tokens remain", async () => {
    const api = installFakeApi({ tags: [fakeTag("finance")] });
    render(<App />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Inbox" }));

    await quickAdd("#finance !high");

    expect(taskPosts(api.requests)).toHaveLength(0);
  });
});
