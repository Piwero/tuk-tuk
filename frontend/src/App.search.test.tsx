import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { fakeCheckItem, fakeList, fakeTag, fakeTask, INBOX, installFakeApi } from "./test/fakeApi";

async function searchFor(query: string): Promise<void> {
  const box = await screen.findByRole("searchbox", { name: "Search tasks" });
  fireEvent.change(box, { target: { value: query } });
  fireEvent.submit(box);
}

const searchRequests = (api: { requests: { method: string; url: string }[] }): string[] =>
  api.requests
    .filter((request) => request.method === "GET" && request.url.includes("search="))
    .map((request) => request.url);

describe("Search", () => {
  it("matches titles, descriptions and Check Item titles, case-insensitively", async () => {
    installFakeApi({
      tasks: [
        fakeTask("Buy groceries"),
        fakeTask("Errand", { description: "pick up the dry GROCERIES order" }),
        fakeTask("Pack bags", { check_items: [fakeCheckItem("groceries for the trip")] }),
        fakeTask("Write report"),
      ],
    });
    render(<App />);

    await searchFor("Groceries");

    expect(await screen.findByRole("button", { name: "Buy groceries" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Errand" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pack bags" })).toBeInTheDocument();
    expect(screen.queryByText("Write report")).not.toBeInTheDocument();
  });

  it("narrows by List, Tag, Priority and completion, combined", async () => {
    const work = fakeTag("work");
    const project = fakeList("Project");
    installFakeApi({
      lists: [INBOX, project],
      tags: [work],
      tasks: [
        fakeTask("Report draft", { list_id: project.id, priority: "high", tags: [work] }),
        fakeTask("Report notes", { list_id: project.id, priority: "high" }),
        fakeTask("Report inbox copy"),
        fakeTask("Report done", {
          list_id: project.id,
          completed: true,
          completed_at: "2026-07-01T10:00:00Z",
        }),
      ],
    });
    render(<App />);

    await searchFor("report");
    expect(await screen.findByRole("button", { name: "Report inbox copy" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "List" }), {
      target: { value: String(project.id) },
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Report inbox copy" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Report done" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), {
      target: { value: "open" },
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Report done" })).not.toBeInTheDocument(),
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Priority" }), {
      target: { value: "high" },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Report draft" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Report notes" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Tag" }), {
      target: { value: String(work.id) },
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Report notes" })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Report draft" })).toBeInTheDocument();
  });

  it("opens the task's detail panel from a result", async () => {
    installFakeApi({ tasks: [fakeTask("Buy groceries")] });
    render(<App />);

    await searchFor("groceries");
    fireEvent.click(await screen.findByRole("button", { name: "Buy groceries" }));

    const panel = await screen.findByRole("complementary", { name: "Task details" });
    expect(within(panel).getByRole("textbox", { name: "Task title" })).toHaveValue("Buy groceries");
  });

  it("fetches nothing for an empty query", async () => {
    const api = installFakeApi({ tasks: [fakeTask("Anything")] });
    render(<App />);

    await searchFor("   ");

    expect(await screen.findByText("Type to search")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Anything" })).not.toBeInTheDocument();
    expect(searchRequests(api)).toEqual([]);
  });
});
