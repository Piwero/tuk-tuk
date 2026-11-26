import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { App } from "./App";
import * as api from "./api";
import { fakeTask, installFakeApi } from "./test/fakeApi";

beforeEach(() => vi.restoreAllMocks());

const draft: api.BrainDumpDraft = {
  type: "create_task",
  title: "Call dentist",
  list_name: null,
  tag_names: [],
  priority: "none",
  start_date: null,
  due_date: null,
  is_all_day: false,
  time_zone: null,
};
async function open(): Promise<void> {
  const nav = await screen.findByRole("navigation", { name: "Views" });
  fireEvent.click(await within(nav).findByRole("link", { name: "Assistant" }));
  fireEvent.click(await screen.findByRole("button", { name: "Brain dump to Tasks" }));
  await screen.findByText(/local-model/);
}
function setup(suggestions = [draft]) {
  installFakeApi({ assistantAvailable: true });
  vi.spyOn(api, "fetchAssistantConfig").mockResolvedValue({
    base_url: "http://localhost:11434/v1",
    model: "local-model",
    api_key_set: true,
    planning_preferences: null,
  });
  const suggest = vi
    .spyOn(api, "postBrainDump")
    .mockResolvedValue({ message: "Review drafts", discarded_count: 0, suggestions });
  const save = vi.spyOn(api, "createTaskIdempotently").mockResolvedValue(fakeTask("Saved"));
  return { suggest, save };
}
function send(text = "Call dentist tomorrow maybe"): void {
  fireEvent.change(screen.getByLabelText("Pasted text"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Suggest Tasks" }));
}

it("edits individual drafts, preserves input and retries unknown save outcomes with stable identifiers", async () => {
  const { save } = setup();
  save.mockRejectedValueOnce(new Error("lost connection"));
  render(<App />);
  await open();
  send();
  const title = await screen.findByLabelText("Task title");
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(title, { target: { value: "Book dentist" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Task" }));
  fireEvent.click(await screen.findByRole("button", { name: "Retry Save" }));
  await screen.findByText("Task saved.");
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[0]?.[0]).toEqual({ title: "Book dentist" });
  expect(save.mock.calls[0]?.[1]).toBe(save.mock.calls[1]?.[1]);
  expect(screen.getByLabelText("Pasted text")).toHaveValue("Call dentist tomorrow maybe");
  expect(screen.queryByRole("button", { name: "Save Task" })).not.toBeInTheDocument();
});

it("requires visible review of explicit dates, leaves ambiguous dates unset, and discards individually", async () => {
  const { save } = setup([
    { ...draft, due_date: "2026-12-01T00:00:00Z", is_all_day: true },
    { ...draft, title: "Maybe later" },
  ]);
  render(<App />);
  await open();
  send();
  const first = await screen.findByRole("article", { name: "Task draft 1" });
  const second = screen.getByRole("article", { name: "Task draft 2" });
  expect(within(first).getByRole("button", { name: "Save Task" })).toBeDisabled();
  fireEvent.change(within(first).getByLabelText("Choose date"), {
    target: { value: "2026-12-02" },
  });
  fireEvent.click(within(first).getByRole("button", { name: "Save Task" }));
  fireEvent.click(within(second).getByRole("button", { name: "Discard" }));
  await screen.findByText("Task saved.");
  expect(save.mock.calls[0]?.[0]).toEqual({
    title: "Call dentist",
    due_date: "2026-12-02T00:00:00Z",
    is_all_day: true,
  });
  expect(screen.queryByRole("article", { name: "Task draft 2" })).not.toBeInTheDocument();
});

it("keeps original text on provider failure and cancels without writes or refresh replay", async () => {
  const { suggest, save } = setup();
  suggest.mockRejectedValue(new Error("offline"));
  const view = render(<App />);
  await open();
  send();
  await screen.findByText(/Assistant unavailable. Your original text is unchanged/);
  expect(screen.getByLabelText("Pasted text")).toHaveValue("Call dentist tomorrow maybe");
  fireEvent.click(screen.getByRole("button", { name: "Cancel brain dump" }));
  expect(save).not.toHaveBeenCalled();
  view.unmount();
  render(<App />);
  await waitFor(() => expect(save).not.toHaveBeenCalled());
});

it("refuses excess input and excess drafts rather than silently truncating", async () => {
  const { suggest, save } = setup(Array.from({ length: 11 }, () => draft));
  render(<App />);
  await open();
  send("x".repeat(12001));
  expect(suggest).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("nothing has been truncated");
  send();
  await screen.findByText(/another deliberate batch of at most ten/);
  expect(screen.queryByLabelText("Task title")).not.toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
});
