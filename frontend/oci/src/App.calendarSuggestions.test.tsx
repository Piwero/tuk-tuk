import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { openCalendar, pinCalendarClock } from "./test/calendar";
import { fakeList, fakeTag, INBOX, installFakeApi, type RecordedRequest } from "./test/fakeApi";

pinCalendarClock();

const taskPosts = (requests: RecordedRequest[]): unknown[] =>
  requests.filter((r) => r.method === "POST" && r.url === "/api/v1/tasks").map((r) => r.body);

async function openDraft(): Promise<HTMLElement> {
  fireEvent.click(screen.getByLabelText("2026-07-15"));
  return screen.findByRole("combobox", { name: "New task title" });
}

describe("Calendar draft # / ~ / ! suggestion dropdown", () => {
  it("opens on # and lists every existing tag", async () => {
    const books = fakeTag("Books");
    const fun = fakeTag("Fun");
    installFakeApi({ tags: [books, fun] });
    render(<App />);
    const user = userEvent.setup();
    await openCalendar();

    const input = await openDraft();
    await user.type(input, "#");

    const listbox = await screen.findByRole("listbox");
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Books", "Fun"]);
  });

  it("picks a tag suggestion, replacing the token with a chip, and attaches it on submit", async () => {
    const books = fakeTag("Books");
    const api = installFakeApi({ tags: [books] });
    render(<App />);
    const user = userEvent.setup();
    await openCalendar();

    const input = await openDraft();
    await user.type(input, "Dentist #bo");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(await screen.findByRole("button", { name: "Remove Books" })).toBeInTheDocument();
    expect(input).toHaveValue("Dentist ");

    await user.type(input, "{Enter}");
    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "Dentist",
      due_date: "2026-07-15T00:00:00Z",
      is_all_day: true,
      time_zone: "UTC",
      tag_ids: [books.id],
    });
  });

  it("picks a ~list suggestion and files the created task under it", async () => {
    const work = fakeList("Work");
    const api = installFakeApi({ lists: [INBOX, work] });
    render(<App />);
    const user = userEvent.setup();
    await openCalendar();

    const input = await openDraft();
    await user.type(input, "Standup ~wo");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(await screen.findByRole("button", { name: "Remove Work" })).toBeInTheDocument();

    await user.type(input, "{Enter}");
    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "Standup",
      due_date: "2026-07-15T00:00:00Z",
      is_all_day: true,
      time_zone: "UTC",
      list_id: work.id,
    });
  });

  it("picks a !priority suggestion and sets it on the created task", async () => {
    const api = installFakeApi();
    render(<App />);
    const user = userEvent.setup();
    await openCalendar();

    const input = await openDraft();
    await user.type(input, "Ship it !hi");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(await screen.findByRole("button", { name: "Remove high" })).toBeInTheDocument();

    await user.type(input, "{Enter}");
    await waitFor(() => expect(taskPosts(api.requests)).toHaveLength(1));
    expect(taskPosts(api.requests)[0]).toEqual({
      title: "Ship it",
      due_date: "2026-07-15T00:00:00Z",
      is_all_day: true,
      time_zone: "UTC",
      priority: "high",
    });
  });

  it("Cancel clears any picked chips along with the draft", async () => {
    const books = fakeTag("Books");
    installFakeApi({ tags: [books] });
    render(<App />);
    const user = userEvent.setup();
    await openCalendar();

    const input = await openDraft();
    await user.type(input, "Dentist #bo");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(await screen.findByRole("button", { name: "Remove Books" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("combobox", { name: "New task title" })).toBeNull();

    // Reopening the draft starts clean — no stray chip survives.
    await openDraft();
    expect(screen.queryByRole("button", { name: "Remove Books" })).toBeNull();
  });
});
