import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeFolder, fakeList, fakeTag, fakeTask, installFakeApi } from "./test/fakeApi";

afterEach(() => {
  vi.restoreAllMocks();
});

function openPalette(): void {
  fireEvent.keyDown(document, { key: "k", metaKey: true });
}

async function seed(): Promise<void> {
  installFakeApi({
    lists: [fakeList("Errands", { id: 10 }), fakeList("Reading", { id: 11 })],
    folders: [fakeFolder("Home", { id: 20 })],
    tags: [fakeTag("urgent", { id: 30 })],
    tasks: [fakeTask("Call the plumber", { list_id: 10 })],
  });
  render(<App />);
  await screen.findByRole("navigation", { name: "Views" });
}

describe("command palette", () => {
  it("opens on cmd/ctrl+K and groups matches by kind", async () => {
    await seed();
    openPalette();

    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "e" } });

    // "e" hits a Smart List (a Task view), Lists, a Folder and a Tag.
    expect(within(dialog).getByRole("group", { name: "Lists" })).toBeInTheDocument();
    expect(within(dialog).getByRole("group", { name: "Folders" })).toBeInTheDocument();
    expect(within(dialog).getByRole("group", { name: "Tags" })).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: "Errands" })).toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: "#urgent" })).toBeInTheDocument();
  });

  it("opens even from a focused text field", async () => {
    const user = userEvent.setup();
    await seed();
    fireEvent.click(await screen.findByRole("button", { name: "Errands" }));
    const field = await screen.findByRole("combobox", { name: "Add a task" });
    await user.click(field);
    expect(field).toHaveFocus();

    openPalette();

    expect(await screen.findByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
  });

  it("arrows through results and Enter navigates to the pick", async () => {
    await seed();
    openPalette();
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "Reading" } });

    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "Enter" });

    await screen.findByRole("heading", { name: "Reading" });
    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
  });

  it("finds an open Task and opens its detail", async () => {
    await seed();
    openPalette();
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "plumber" } });
    fireEvent.click(within(dialog).getByRole("option", { name: "Call the plumber" }));

    const detail = await screen.findByRole("complementary", { name: "Task details" });
    expect(within(detail).getByRole("textbox", { name: "Task title" })).toHaveValue(
      "Call the plumber",
    );
  });

  it("closes on Escape and restores focus to the opener", async () => {
    await seed();
    const nav = await screen.findByRole("navigation", { name: "Views" });
    const tasksNav = within(nav).getByRole("button", { name: "Tasks" });
    tasksNav.focus();

    openPalette();
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument(),
    );
    expect(tasksNav).toHaveFocus();
  });

  it("traps Tab within the palette", async () => {
    await seed();
    openPalette();
    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    const field = within(dialog).getByRole("combobox");
    field.focus();

    fireEvent.keyDown(dialog, { key: "Tab" });

    expect(field).toHaveFocus();
  });
});
