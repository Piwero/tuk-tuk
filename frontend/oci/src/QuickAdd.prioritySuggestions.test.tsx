import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { installFakeApi, INBOX, type RecordedRequest } from "./test/fakeApi";

const taskPosts = (requests: RecordedRequest[]): unknown[] =>
  requests.filter((r) => r.method === "POST" && r.url === "/api/v1/tasks").map((r) => r.body);

describe("Quick-Add ! suggestion dropdown", () => {
  it("opens on a bare ! and lists all three priority levels, high to low", async () => {
    installFakeApi({});
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "!");

    const listbox = await screen.findByRole("listbox");
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["High", "Medium", "Low"]);
  });

  it("narrows the options by case-insensitive prefix as the query is typed", async () => {
    installFakeApi({});
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "!HI");

    const listbox = await screen.findByRole("listbox");
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["High"]);
  });

  it("never offers a create row, even for a near-miss like !hi", async () => {
    installFakeApi({});
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "!zzz");

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("picking a level removes the token text and shows a chip; picking another replaces it", async () => {
    installFakeApi({});
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "read !hi");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(await screen.findByRole("button", { name: "Remove high" })).toBeInTheDocument();
    expect(input).toHaveValue("read ");

    await user.type(input, "!lo");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(await screen.findByRole("button", { name: "Remove low" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove high" })).toBeNull();
  });

  it("the created task carries the chipped priority", async () => {
    const api = installFakeApi({});
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "read !hi");
    await user.keyboard("{ArrowDown}{Enter}");
    await user.type(input, "{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "read",
      list_id: INBOX.id,
      priority: "high",
    });
  });

  it("an unpicked !token still parses at submit time exactly as before", async () => {
    const api = installFakeApi({});
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "read !high{Enter}");

    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "read",
      list_id: INBOX.id,
      priority: "high",
    });
  });
});
