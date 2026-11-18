import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { fakeCheckItem, fakeFocusSession, fakeTask, installFakeApi } from "./test/fakeApi";

async function openDetail(taskTitle: string): Promise<HTMLElement> {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: `Open details for ${taskTitle}` }));
  return await screen.findByRole("complementary", { name: "Task details" });
}

const patchesTo = (api: ReturnType<typeof installFakeApi>, url: string): unknown[] =>
  api.requests.filter((r) => r.method === "PATCH" && r.url === url).map((r) => r.body);

describe("Task detail description (#455)", () => {
  it("edits on click and saves on blur, with no Edit/Save/Cancel buttons", async () => {
    const report = fakeTask("Write report", { description: "plain text" });
    const api = installFakeApi({ tasks: [report] });
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail("Write report");
    expect(within(panel).queryByRole("button", { name: /Edit description/ })).toBeNull();
    await user.click(within(panel).getByText("plain text"));
    const editor = within(panel).getByRole("textbox", { name: "Description" });
    expect(editor).toHaveValue("plain text");
    expect(within(panel).queryByRole("button", { name: /Save|Cancel/ })).toBeNull();
    await user.clear(editor);
    await user.type(editor, "# Heading");
    await user.tab();

    expect(await within(panel).findByRole("heading", { name: "Heading" })).toBeInTheDocument();
    expect(patchesTo(api, `/api/v1/tasks/${report.id}`)).toEqual([{ description: "# Heading" }]);
  });

  it("discards the edit on Escape", async () => {
    const report = fakeTask("Write report", { description: "plain **text**" });
    const api = installFakeApi({ tasks: [report] });
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail("Write report");
    await user.click(within(panel).getByText("text"));
    await user.type(within(panel).getByRole("textbox", { name: "Description" }), " more");
    await user.keyboard("{Escape}");

    expect(within(panel).queryByRole("textbox", { name: "Description" })).toBeNull();
    expect(within(panel).getByText("text").tagName).toBe("STRONG");
    expect(screen.getByRole("complementary", { name: "Task details" })).toBeInTheDocument();
    expect(patchesTo(api, `/api/v1/tasks/${report.id}`)).toEqual([]);
  });

  it("offers a placeholder to start an empty description", async () => {
    const report = fakeTask("Write report");
    const api = installFakeApi({ tasks: [report] });
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail("Write report");
    await user.click(within(panel).getByText("Add a description…"));
    await user.type(within(panel).getByRole("textbox", { name: "Description" }), "Notes");
    await user.tab();

    expect(await within(panel).findByText("Notes")).toBeInTheDocument();
    expect(patchesTo(api, `/api/v1/tasks/${report.id}`)).toEqual([{ description: "Notes" }]);
  });
});

describe("Task detail Check Items progress (#455)", () => {
  it("shows 'n of m' and a progress bar right after the description", async () => {
    const trip = fakeTask("Pack bags", {
      check_items: [
        fakeCheckItem("Socks", { done: true }),
        fakeCheckItem("Charger"),
        fakeCheckItem("Passport"),
      ],
    });
    installFakeApi({ tasks: [trip] });
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail("Pack bags");
    const bar = within(panel).getByRole("progressbar", { name: "Check items progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "1");
    expect(bar).toHaveAttribute("aria-valuemax", "3");
    expect(within(panel).getByText("1 of 3")).toBeInTheDocument();

    await user.click(within(panel).getByRole("checkbox", { name: "Tick Charger" }));
    expect(await within(panel).findByText("2 of 3")).toBeInTheDocument();

    const description = panel.querySelector(".task-description");
    const checkItems = panel.querySelector(".check-items");
    expect(description?.nextElementSibling).toBe(checkItems);
  });
});

describe("Task detail Start focus (#455)", () => {
  it("shows the time focused on this Task and opens Focus with it linked, clock idle", async () => {
    const report = fakeTask("Write report");
    const other = fakeTask("Other");
    const api = installFakeApi({
      tasks: [report, other],
      focusSessions: [
        fakeFocusSession({ task_id: report.id }), // 30 min
        fakeFocusSession({
          task_id: report.id,
          started_at: "2026-07-03T10:00:00Z",
          ended_at: "2026-07-03T10:20:00Z",
        }),
        fakeFocusSession({ task_id: other.id }),
      ],
    });
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail("Write report");
    const start = await within(panel).findByRole("button", { name: /Start focus/ });
    await waitFor(() => expect(start).toHaveTextContent("50 min focused"));
    await user.click(start);

    expect(await screen.findByRole("heading", { name: "Focus" })).toBeInTheDocument();
    const main = within(screen.getByRole("main"));
    expect(await main.findByRole("button", { name: "Linked: Write report" })).toBeInTheDocument();
    expect(main.queryByRole("button", { name: "Pause" })).toBeNull();
    expect(
      api.requests.filter((r) => r.method !== "GET" && r.url.startsWith("/api/v1/focus-sessions")),
    ).toEqual([]);
  });
});

describe("Task detail overflow menu (#455)", () => {
  it("holds Delete, which removes the Task and closes the detail", async () => {
    installFakeApi({ tasks: [fakeTask("Write report")] });
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail("Write report");
    expect(within(panel).queryByRole("menuitem", { name: /Delete/ })).toBeNull();
    await user.click(within(panel).getByRole("button", { name: "More task actions" }));
    await user.click(within(panel).getByRole("menuitem", { name: "Delete task" }));

    await waitFor(() =>
      expect(screen.queryByRole("complementary", { name: "Task details" })).toBeNull(),
    );
    expect(screen.queryByRole("button", { name: "Open details for Write report" })).toBeNull();
    expect(await screen.findByText("Task deleted")).toBeInTheDocument();
  });
});
