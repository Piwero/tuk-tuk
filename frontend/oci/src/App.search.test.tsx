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

    expect(
      await screen.findByRole("button", { name: "Open details for Buy groceries" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open details for Errand" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open details for Pack bags" })).toBeInTheDocument();
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
    expect(
      await screen.findByRole("button", { name: "Open details for Report inbox copy" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "List" }), {
      target: { value: String(project.id) },
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Open details for Report inbox copy" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Open details for Report done" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Status" }), {
      target: { value: "open" },
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Open details for Report done" }),
      ).not.toBeInTheDocument(),
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Priority" }), {
      target: { value: "high" },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Open details for Report draft" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Open details for Report notes" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Tag" }), {
      target: { value: String(work.id) },
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Open details for Report notes" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Open details for Report draft" }),
    ).toBeInTheDocument();
  });

  it("opens the task's detail panel from a result", async () => {
    installFakeApi({ tasks: [fakeTask("Buy groceries")] });
    render(<App />);

    await searchFor("groceries");
    fireEvent.click(await screen.findByRole("button", { name: "Open details for Buy groceries" }));

    const panel = await screen.findByRole("complementary", { name: "Task details" });
    expect(within(panel).getByRole("textbox", { name: "Task title" })).toHaveValue("Buy groceries");
  });

  it("fetches nothing for an empty query", async () => {
    const api = installFakeApi({ tasks: [fakeTask("Anything")] });
    render(<App />);

    await searchFor("   ");

    expect(await screen.findByText("Type to search")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open details for Anything" }),
    ).not.toBeInTheDocument();
    expect(searchRequests(api)).toEqual([]);
  });

  it("completes a task from a search result, same as any other row", async () => {
    const api = installFakeApi({ tasks: [fakeTask("Buy groceries")] });
    render(<App />);

    await searchFor("groceries");
    const checkbox = await screen.findByRole("checkbox", { name: "Complete Buy groceries" });
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);

    const patch = await waitFor(() => {
      const request = api.requests.find((r) => r.method === "PATCH");
      expect(request).toBeDefined();
      return request;
    });
    expect(patch?.body).toEqual({ completed: true });
  });

  it("labels each result's List, since results can span every List", async () => {
    const errands = fakeList("Errands");
    installFakeApi({
      lists: [INBOX, errands],
      tasks: [fakeTask("Buy groceries", { list_id: errands.id })],
    });
    render(<App />);

    await searchFor("groceries");
    const row = (
      await screen.findByRole("button", { name: "Open details for Buy groceries" })
    ).closest("li");
    if (row === null) {
      throw new Error("row not found");
    }
    expect(within(row).getByText("Errands")).toBeInTheDocument();
  });

  it("shows the priority indicator on a result with a non-default priority", async () => {
    installFakeApi({
      tasks: [fakeTask("Buy groceries", { priority: "high" })],
    });
    render(<App />);

    await searchFor("groceries");
    const row = (
      await screen.findByRole("button", { name: "Open details for Buy groceries" })
    ).closest("li");
    if (row === null) {
      throw new Error("row not found");
    }
    expect(within(row).getByLabelText("Priority: High")).toBeInTheDocument();
  });

  it("shows a distinct hint before a query and a distinct message when a query has no matches", async () => {
    installFakeApi({ tasks: [fakeTask("Buy groceries")] });
    render(<App />);

    const nav = await screen.findByRole("navigation", { name: "Views" });
    fireEvent.click(within(nav).getByRole("link", { name: "Search" }));
    expect(await screen.findByText(/type to search/i)).toBeInTheDocument();

    await searchFor("no such task");
    await waitFor(() =>
      expect(screen.getByText(/no matches for.*no such task/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/type to search/i)).not.toBeInTheDocument();
  });
});
