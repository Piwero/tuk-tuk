import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { closestOrThrow, fakeDataTransfer } from "./test/dnd";
import { fakeCheckItem, fakeTask, installFakeApi } from "./test/fakeApi";

// Note: fetch stays stubbed across tests (each test installs a fresh fake).
// Restoring the real fetch between tests would let a late in-flight request
// from an unmounting App escape to the network and fail the run.

async function openDetail(taskTitle: string): Promise<HTMLElement> {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: `Open details for ${taskTitle}` }));
  return await screen.findByRole("complementary", { name: "Task details" });
}

describe("Task detail panel", () => {
  it("opens from a task row with editable title and Markdown-rendered description", async () => {
    installFakeApi({
      tasks: [fakeTask("Write report", { description: "An **important** report" })],
    });
    render(<App />);

    const panel = await openDetail("Write report");

    expect(within(panel).getByRole("textbox", { name: "Task title" })).toHaveValue("Write report");
    const bold = within(panel).getByText("important");
    expect(bold.tagName).toBe("STRONG");
  });

  it("saves an edited title and updates the task row", async () => {
    const report = fakeTask("Write reprot");
    const api = installFakeApi({ tasks: [report] });
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail("Write reprot");
    const titleInput = within(panel).getByRole("textbox", { name: "Task title" });
    await user.clear(titleInput);
    await user.type(titleInput, "Write report");
    await user.tab();

    expect(
      await screen.findByRole("button", { name: "Open details for Write report" }),
    ).toBeInTheDocument();
    const patch = api.requests.find(
      (r) => r.method === "PATCH" && r.url === `/api/v1/tasks/${report.id}`,
    );
    expect(patch?.body).toEqual({ title: "Write report" });
  });

  it("edits the description in a textarea and renders the saved Markdown", async () => {
    const report = fakeTask("Write report", { description: "plain text" });
    const api = installFakeApi({ tasks: [report] });
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail("Write report");
    await user.click(within(panel).getByRole("button", { name: "Edit description" }));
    const editor = within(panel).getByRole("textbox", { name: "Description" });
    expect(editor).toHaveValue("plain text");
    await user.clear(editor);
    await user.type(editor, "# Heading");
    await user.click(within(panel).getByRole("button", { name: "Save description" }));

    expect(await within(panel).findByRole("heading", { name: "Heading" })).toBeInTheDocument();
    const patch = api.requests.find(
      (r) => r.method === "PATCH" && r.url === `/api/v1/tasks/${report.id}`,
    );
    expect(patch?.body).toEqual({ description: "# Heading" });
  });

  it("sets Priority from the four named levels and marks the task row", async () => {
    const report = fakeTask("Write report");
    const api = installFakeApi({ tasks: [report] });
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail("Write report");
    const select = within(panel).getByRole("combobox", { name: "Priority" });
    expect(
      within(select)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["None", "Low", "Medium", "High"]);

    await user.selectOptions(select, "High");

    const row = screen.getByRole("button", { name: "Open details for Write report" }).closest("li");
    await waitFor(() => expect(row).toHaveAttribute("data-priority", "high"));
    const patch = api.requests.find(
      (r) => r.method === "PATCH" && r.url === `/api/v1/tasks/${report.id}`,
    );
    expect(patch?.body).toEqual({ priority: "high" });
  });

  it("adds Check Items and shows n/m progress on the task row", async () => {
    const trip = fakeTask("Pack bags");
    const api = installFakeApi({ tasks: [trip] });
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail("Pack bags");
    const input = within(panel).getByRole("textbox", { name: "Add a check item" });
    await user.type(input, "Socks{Enter}");
    await user.type(input, "Charger{Enter}");

    const items = within(panel).getByRole("list", { name: "Check items" });
    expect(await within(items).findByText("Socks")).toBeInTheDocument();
    expect(within(items).getByText("Charger")).toBeInTheDocument();

    const row = screen.getByRole("button", { name: "Open details for Pack bags" }).closest("li");
    expect(row).toHaveTextContent("0/2");
    const posts = api.requests.filter(
      (r) => r.method === "POST" && r.url === `/api/v1/tasks/${trip.id}/check-items`,
    );
    expect(posts.map((r) => r.body)).toEqual([{ title: "Socks" }, { title: "Charger" }]);
  });

  it("ticking the last open Check Item completes the task; un-ticking keeps it done", async () => {
    const socks = fakeCheckItem("Socks");
    const charger = fakeCheckItem("Charger");
    const trip = fakeTask("Pack bags", { check_items: [socks, charger] });
    installFakeApi({ tasks: [trip] });
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail("Pack bags");
    await user.click(within(panel).getByRole("checkbox", { name: "Tick Socks" }));

    const row = screen.getByRole("button", { name: "Open details for Pack bags" }).closest("li");
    expect(row).toHaveTextContent("1/2");
    expect(screen.getByRole("checkbox", { name: "Complete Pack bags" })).not.toBeChecked();

    await user.click(within(panel).getByRole("checkbox", { name: "Tick Charger" }));

    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Complete Pack bags" })).toBeChecked(),
    );

    await user.click(within(panel).getByRole("checkbox", { name: "Tick Charger" }));

    await waitFor(() =>
      expect(within(panel).getByRole("checkbox", { name: "Tick Charger" })).not.toBeChecked(),
    );
    expect(screen.getByRole("checkbox", { name: "Complete Pack bags" })).toBeChecked();
  });

  it("renames and deletes a Check Item", async () => {
    const sockz = fakeCheckItem("Sockz");
    const charger = fakeCheckItem("Charger");
    const trip = fakeTask("Pack bags", { check_items: [sockz, charger] });
    const api = installFakeApi({ tasks: [trip] });
    const user = userEvent.setup();
    render(<App />);

    const panel = await openDetail("Pack bags");
    await user.click(within(panel).getByRole("button", { name: "Edit check item Sockz" }));
    const editor = within(panel).getByRole("textbox", { name: "Check item title" });
    expect(editor).toHaveValue("Sockz");
    await user.clear(editor);
    await user.type(editor, "Socks{Enter}");

    const items = within(panel).getByRole("list", { name: "Check items" });
    expect(await within(items).findByText("Socks")).toBeInTheDocument();
    const patch = api.requests.find(
      (r) => r.method === "PATCH" && r.url === `/api/v1/tasks/${trip.id}/check-items/${sockz.id}`,
    );
    expect(patch?.body).toEqual({ title: "Socks" });

    await user.click(within(panel).getByRole("button", { name: "Delete check item Charger" }));

    await waitFor(() => expect(within(items).queryByText("Charger")).not.toBeInTheDocument());
    expect(
      api.requests.some(
        (r) =>
          r.method === "DELETE" && r.url === `/api/v1/tasks/${trip.id}/check-items/${charger.id}`,
      ),
    ).toBe(true);
  });

  it("reorders Check Items by drag", async () => {
    const socks = fakeCheckItem("Socks", { sort_order: 1024 });
    const charger = fakeCheckItem("Charger", { sort_order: 2048 });
    const passport = fakeCheckItem("Passport", { sort_order: 3072 });
    const trip = fakeTask("Pack bags", { check_items: [socks, charger, passport] });
    const api = installFakeApi({ tasks: [trip] });
    render(<App />);

    const panel = await openDetail("Pack bags");
    const items = within(panel).getByRole("list", { name: "Check items" });
    const dataTransfer = fakeDataTransfer();
    const rowFor = (text: string): HTMLElement =>
      closestOrThrow(within(items).getByText(text), "li");
    fireEvent.dragStart(rowFor("Passport"), { dataTransfer });
    fireEvent.drop(rowFor("Charger"), { dataTransfer });

    await waitFor(() => {
      const ticks = within(items).getAllByRole("checkbox");
      expect(ticks.map((box) => box.getAttribute("aria-label"))).toEqual([
        "Tick Socks",
        "Tick Passport",
        "Tick Charger",
      ]);
    });
    const patch = api.requests.find(
      (r) =>
        r.method === "PATCH" && r.url === `/api/v1/tasks/${trip.id}/check-items/${passport.id}`,
    );
    expect(patch?.body).toEqual({ sort_order: 1536 });
  });

  it("drops a Check Item on the list itself to move it to the end", async () => {
    const socks = fakeCheckItem("Socks", { sort_order: 1024 });
    const charger = fakeCheckItem("Charger", { sort_order: 2048 });
    const trip = fakeTask("Pack bags", { check_items: [socks, charger] });
    const api = installFakeApi({ tasks: [trip] });
    render(<App />);

    const panel = await openDetail("Pack bags");
    const items = within(panel).getByRole("list", { name: "Check items" });
    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(closestOrThrow(within(items).getByText("Socks"), "li"), { dataTransfer });
    fireEvent.drop(items, { dataTransfer });

    await waitFor(() => {
      const ticks = within(items).getAllByRole("checkbox");
      expect(ticks.map((box) => box.getAttribute("aria-label"))).toEqual([
        "Tick Charger",
        "Tick Socks",
      ]);
    });
    const patch = api.requests.find(
      (r) => r.method === "PATCH" && r.url === `/api/v1/tasks/${trip.id}/check-items/${socks.id}`,
    );
    expect(patch?.body).toEqual({ sort_order: 3072 });
  });
});
