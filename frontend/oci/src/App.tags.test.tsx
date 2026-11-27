import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeList, fakeTag, fakeTask, INBOX, installFakeApi } from "./test/fakeApi";

// Note: fetch stays stubbed across tests (each test installs a fresh fake).
// Restoring the real fetch between tests would let a late in-flight request
// from an unmounting App escape to the network and fail the run.

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Tags in the sidebar", () => {
  it("lists existing Tags and creates one with name and color", async () => {
    const api = installFakeApi({ tags: [fakeTag("work", { color: "#4772fa" })] });
    const user = userEvent.setup();
    render(<App />);

    const nav = await screen.findByRole("navigation", { name: "Tags" });
    expect(within(nav).getByRole("link", { name: "work" })).toBeInTheDocument();

    await user.click(within(nav).getByRole("button", { name: "Add Tag" }));
    await user.type(screen.getByLabelText("Tag name"), "errand");
    fireEvent.change(screen.getByLabelText("Tag color"), { target: { value: "#00c853" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await within(nav).findByRole("link", { name: "errand" })).toBeInTheDocument();
    const post = api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/tags");
    expect(post?.body).toEqual({ name: "errand", color: "#00c853" });
  });

  it("shows the API error when creating a duplicate Tag name", async () => {
    installFakeApi({ tags: [fakeTag("work")] });
    const user = userEvent.setup();
    render(<App />);

    const nav = await screen.findByRole("navigation", { name: "Tags" });
    await user.click(within(nav).getByRole("button", { name: "Add Tag" }));
    await user.type(screen.getByLabelText("Tag name"), "work");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent('A tag named "work" already exists');
    expect(screen.getByLabelText("Tag name")).toBeInTheDocument(); // form stays open
    expect(within(nav).getAllByRole("link", { name: "work" })).toHaveLength(1);
  });

  it("clicking a Tag shows its tasks from every List", async () => {
    const work = fakeTag("work");
    const errands = fakeList("Errands");
    const inboxTask = fakeTask("Email boss", { tags: [work] });
    const errandTask = fakeTask("Print badge", { list_id: errands.id, tags: [work] });
    const untagged = fakeTask("Water plants");
    const api = installFakeApi({
      lists: [INBOX, errands],
      tags: [work],
      tasks: [inboxTask, errandTask, untagged],
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Water plants");

    const tagsNav = screen.getByRole("navigation", { name: "Tags" });
    await user.click(within(tagsNav).getByRole("link", { name: "work" }));

    expect(await screen.findByRole("heading", { name: "#work" })).toBeInTheDocument();
    expect(screen.getByText("Email boss")).toBeInTheDocument();
    expect(screen.getByText("Print badge")).toBeInTheDocument();
    expect(screen.queryByText("Water plants")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Add a task" })).not.toBeInTheDocument();
    expect(
      api.requests.some((r) => r.method === "GET" && r.url === `/api/v1/tasks?tag_id=${work.id}`),
    ).toBe(true);
  });
});

describe("Tags on a task", () => {
  async function openTags(): Promise<HTMLElement> {
    const user = userEvent.setup();
    const panel = await screen.findByRole("complementary", { name: "Task details" });
    await user.click(within(panel).getByRole("button", { name: /^Tags/ }));
    return within(panel).getByRole("dialog", { name: "Tags" });
  }

  function taskRow(title: string): HTMLElement {
    const row = screen.getByRole("button", { name: `Open details for ${title}` }).closest("li");
    if (!(row instanceof HTMLElement)) throw new Error("task row not found");
    return row;
  }

  it("shows only the Task's own Tags as chips, with no checkbox list", async () => {
    const work = fakeTag("work");
    const errand = fakeTag("errand");
    installFakeApi({ tags: [work, errand], tasks: [fakeTask("Write report", { tags: [work] })] });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Open details for Write report" }));
    const panel = await screen.findByRole("complementary", { name: "Task details" });

    expect(within(panel).queryAllByRole("checkbox", { name: /^Tag / })).toHaveLength(0);
    const trigger = within(panel).getByRole("button", { name: /^Tags/ });
    expect(within(trigger).getByText("work")).toBeInTheDocument();
    expect(within(trigger).queryByText("errand")).not.toBeInTheDocument();
  });

  it("narrows suggestions by prefix and tags the Task with the pick", async () => {
    const work = fakeTag("work");
    const errand = fakeTag("errand");
    const workshop = fakeTag("Workshop");
    const report = fakeTask("Write report");
    const api = installFakeApi({ tags: [work, errand, workshop], tasks: [report] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Open details for Write report" }));

    const editor = await openTags();
    await user.type(within(editor).getByRole("combobox", { name: "Add a tag" }), "wo");

    const listbox = within(editor).getByRole("listbox", { name: "Tag suggestions" });
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["work", "Workshop", "Create “wo”"]);

    await user.click(within(listbox).getByRole("option", { name: "work" }));

    expect(await within(taskRow("Write report")).findByText("work")).toBeInTheDocument();
    const patch = api.requests.filter((r) => r.method === "PATCH").pop();
    expect(patch?.body).toEqual({ tag_ids: [work.id] });
  });

  it("does not suggest Tags the Task already has", async () => {
    const work = fakeTag("work");
    const workshop = fakeTag("workshop");
    installFakeApi({ tags: [work, workshop], tasks: [fakeTask("Write report", { tags: [work] })] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Open details for Write report" }));

    const editor = await openTags();
    await user.type(within(editor).getByRole("combobox", { name: "Add a tag" }), "work");

    const listbox = within(editor).getByRole("listbox", { name: "Tag suggestions" });
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["workshop"]);
  });

  it("creates a Tag that does not exist and applies it", async () => {
    const report = fakeTask("Write report");
    const api = installFakeApi({ tags: [], tasks: [report] });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Open details for Write report" }));

    const editor = await openTags();
    await user.type(within(editor).getByRole("combobox", { name: "Add a tag" }), "urgent{Enter}");

    expect(await within(taskRow("Write report")).findByText("urgent")).toBeInTheDocument();
    const post = api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/tags");
    expect(post?.body).toEqual({ name: "urgent" });
    const created = api.tags.find((t) => t.name === "urgent");
    const patch = api.requests.filter((r) => r.method === "PATCH").pop();
    expect(patch?.body).toEqual({ tag_ids: [created?.id] });
    const tagsNav = screen.getByRole("navigation", { name: "Tags" });
    expect(within(tagsNav).getByRole("link", { name: "urgent" })).toBeInTheDocument();
  });

  it("removing a chip untags the Task", async () => {
    const work = fakeTag("work");
    const errand = fakeTag("errand");
    const api = installFakeApi({
      tags: [work, errand],
      tasks: [fakeTask("Write report", { tags: [work, errand] })],
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Open details for Write report" }));

    const editor = await openTags();
    await user.click(within(editor).getByRole("button", { name: "Remove tag work" }));

    await waitFor(() =>
      expect(within(taskRow("Write report")).queryByText("work")).not.toBeInTheDocument(),
    );
    const patch = api.requests.filter((r) => r.method === "PATCH").pop();
    expect(patch?.body).toEqual({ tag_ids: [errand.id] });
  });

  it("removing the viewed Tag from a task drops it from the tag view", async () => {
    const work = fakeTag("work");
    const report = fakeTask("Write report", { tags: [work] });
    installFakeApi({ tags: [work], tasks: [report] });
    const user = userEvent.setup();
    render(<App />);

    const tagsNav = await screen.findByRole("navigation", { name: "Tags" });
    await user.click(await within(tagsNav).findByRole("link", { name: "work" }));
    await screen.findByRole("heading", { name: "#work" });
    await user.click(screen.getByRole("button", { name: "Open details for Write report" }));

    const editor = await openTags();
    await user.click(within(editor).getByRole("button", { name: "Remove tag work" }));

    await waitFor(() => expect(screen.queryByText("Write report")).not.toBeInTheDocument());
  });

  it("renaming a Tag updates the sidebar and every task chip", async () => {
    const work = fakeTag("wrok");
    const report = fakeTask("Write report", { tags: [work] });
    const api = installFakeApi({ tags: [work], tasks: [report] });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText("Write report");

    const tagsNav = screen.getByRole("navigation", { name: "Tags" });
    await user.click(within(tagsNav).getByRole("button", { name: "Edit tag wrok" }));
    const input = screen.getByLabelText("Tag name");
    await user.clear(input);
    await user.type(input, "work");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await within(tagsNav).findByRole("link", { name: "work" })).toBeInTheDocument();
    const row = screen.getByRole("button", { name: "Open details for Write report" }).closest("li");
    if (!(row instanceof HTMLElement)) {
      throw new Error("task row not found");
    }
    expect(within(row).getByText("work")).toBeInTheDocument();
    expect(within(row).queryByText("wrok")).not.toBeInTheDocument();
    const patch = api.requests.find(
      (r) => r.method === "PATCH" && r.url === `/api/v1/tags/${work.id}`,
    );
    expect(patch?.body).toEqual({ name: "work", color: "#4772fa" });
  });

  it("deleting a Tag detaches it from tasks without touching them", async () => {
    const fleeting = fakeTag("fleeting");
    const survivor = fakeTask("Survivor", { tags: [fleeting] });
    const api = installFakeApi({ tags: [fleeting], tasks: [survivor] });
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);
    await screen.findByText("Survivor");

    const tagsNav = screen.getByRole("navigation", { name: "Tags" });
    await user.click(within(tagsNav).getByRole("button", { name: "Delete tag fleeting" }));

    await waitFor(() =>
      expect(within(tagsNav).queryByRole("button", { name: "fleeting" })).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Survivor")).toBeInTheDocument();
    expect(screen.queryByText("fleeting")).not.toBeInTheDocument();
    expect(
      api.requests.some((r) => r.method === "DELETE" && r.url === `/api/v1/tags/${fleeting.id}`),
    ).toBe(true);
  });
});
