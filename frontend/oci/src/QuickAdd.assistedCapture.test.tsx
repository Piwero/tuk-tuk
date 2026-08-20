import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { installFakeApi, type RecordedRequest } from "./test/fakeApi";

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
