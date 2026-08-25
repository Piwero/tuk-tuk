import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { fakeTask, installFakeApi } from "./test/fakeApi";

async function openAssistant(): Promise<void> {
  const nav = await screen.findByRole("navigation", { name: "Views" });
  const link = await within(nav).findByRole("link", { name: "Assistant" });
  fireEvent.click(link);
  await screen.findByRole("heading", { name: "Assistant" });
}

async function send(text: string): Promise<void> {
  const input = await screen.findByRole("textbox", { name: "Describe your day" });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
}

describe("Assistant view (ADR 0009, issue #188)", () => {
  it("has no nav item when the Assistant is unconfigured", async () => {
    installFakeApi({ assistantAvailable: false });
    render(<App />);
    const nav = await screen.findByRole("navigation", { name: "Views" });

    await waitFor(() => {
      expect(within(nav).queryByRole("link", { name: "Assistant" })).not.toBeInTheDocument();
    });
  });

  it("shows the nav item and renders Suggestion cards from a turn's response", async () => {
    const task = fakeTask("Write report", { id: 42 });
    const api = installFakeApi({
      assistantAvailable: true,
      tasks: [task],
      assistantChatQueue: [
        {
          message: "Here's a plan for today.",
          discarded_count: 0,
          suggestions: [
            {
              type: "create_task",
              title: "Buy groceries",
              list_name: null,
              tag_names: [],
              priority: "none",
              start_date: null,
              due_date: null,
              is_all_day: false,
              time_zone: null,
            },
            {
              type: "complete_task",
              task_id: 42,
            },
          ],
        },
      ],
    });
    render(<App />);
    await openAssistant();

    await send("Plan my day");

    await screen.findByText("Here's a plan for today.");
    expect(await screen.findByText('Create "Buy groceries"')).toBeInTheDocument();
    expect(await screen.findByText('Complete "Write report"')).toBeInTheDocument();

    await waitFor(() => {
      expect(
        api.requests.some((r) => r.method === "POST" && r.url === "/api/v1/assistant/chat"),
      ).toBe(true);
    });
    const chatRequest = api.requests.find(
      (r) => r.method === "POST" && r.url === "/api/v1/assistant/chat",
    );
    expect((chatRequest?.body as { transcript: unknown[] }).transcript).toEqual([
      { role: "user", content: "Plan my day" },
    ]);
  });

  it("cherry-picked accepts apply only the checked cards, sequentially, through the v1 endpoints", async () => {
    const task = fakeTask("Write report", { id: 42 });
    const api = installFakeApi({
      assistantAvailable: true,
      tasks: [task],
      assistantChatQueue: [
        {
          message: "Here's a plan.",
          discarded_count: 0,
          suggestions: [
            {
              type: "create_task",
              title: "Buy groceries",
              list_name: null,
              tag_names: [],
              priority: "none",
              start_date: null,
              due_date: null,
              is_all_day: false,
              time_zone: null,
            },
            { type: "complete_task", task_id: 42 },
          ],
        },
      ],
    });
    render(<App />);
    await openAssistant();
    await send("Plan my day");

    await screen.findByText('Create "Buy groceries"');
    const groceriesCheckbox = screen.getByLabelText('Create "Buy groceries"');
    fireEvent.click(groceriesCheckbox); // uncheck — leave only complete_task accepted

    fireEvent.click(screen.getByRole("button", { name: /Apply 1 suggestion/ }));

    await screen.findByText("Applied");

    const taskRequests = api.requests.filter(
      (r) => r.method === "POST" && r.url === "/api/v1/tasks",
    );
    expect(taskRequests).toHaveLength(0);
    const patchRequests = api.requests.filter(
      (r) => r.method === "PATCH" && r.url === "/api/v1/tasks/42",
    );
    expect(patchRequests).toHaveLength(1);
    expect(patchRequests[0].body).toEqual({ completed: true });
  });

  it("reports a per-card failure without stopping the rest", async () => {
    const api = installFakeApi({
      assistantAvailable: true,
      tasks: [],
      assistantChatQueue: [
        {
          message: "Here's a plan.",
          discarded_count: 0,
          suggestions: [
            { type: "complete_task", task_id: 999 },
            {
              type: "create_task",
              title: "Buy groceries",
              list_name: null,
              tag_names: [],
              priority: "none",
              start_date: null,
              due_date: null,
              is_all_day: false,
              time_zone: null,
            },
          ],
        },
      ],
    });
    render(<App />);
    await openAssistant();
    await send("Plan my day");

    await screen.findByText('Create "Buy groceries"');
    fireEvent.click(screen.getByRole("button", { name: /Apply 2 suggestions/ }));

    await screen.findByText(/Failed:/);
    expect(await screen.findByText("Applied")).toBeInTheDocument();

    const createRequests = api.requests.filter(
      (r) => r.method === "POST" && r.url === "/api/v1/tasks",
    );
    expect(createRequests).toHaveLength(1);
  });

  it("shows the discarded count the backend reports", async () => {
    installFakeApi({
      assistantAvailable: true,
      assistantChatQueue: [{ message: "Here's a plan.", discarded_count: 3, suggestions: [] }],
    });
    render(<App />);
    await openAssistant();
    await send("Plan my day");

    await screen.findByText("Here's a plan.");
    expect(await screen.findByText(/3 suggestions couldn't be applied/)).toBeInTheDocument();
  });
});
