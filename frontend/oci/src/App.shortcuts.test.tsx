import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { installFakeApi } from "./test/fakeApi";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Renders App and opens the Inbox list so the inline Quick-Add bar is on
 * screen, returning the Inbox nav button (a stable thing to park focus on). */
async function openInbox(): Promise<HTMLElement> {
  const user = userEvent.setup();
  render(<App />);
  const inbox = await screen.findByRole("button", { name: "Inbox" });
  await user.click(inbox);
  await screen.findByRole("combobox", { name: "Add a task" });
  return inbox;
}

describe("global keyboard shortcut layer", () => {
  it("opens Quick-Add on N and restores focus to the opener on close", async () => {
    installFakeApi();
    const inbox = await openInbox();
    inbox.focus();

    fireEvent.keyDown(document.body, { key: "n" });

    const dialog = await screen.findByRole("dialog", { name: "Quick add" });
    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Quick add" })).not.toBeInTheDocument();
    expect(inbox).toHaveFocus();
  });

  it("moves focus to the sidebar search field on /", async () => {
    installFakeApi();
    await openInbox();

    fireEvent.keyDown(document.body, { key: "/" });

    expect(screen.getByRole("searchbox", { name: "Quick search" })).toHaveFocus();
  });

  it("does not fire while a text field has focus", async () => {
    installFakeApi();
    await openInbox();
    const field = screen.getByRole("combobox", { name: "Add a task" });
    field.focus();

    fireEvent.keyDown(field, { key: "n" });

    expect(screen.queryByRole("dialog", { name: "Quick add" })).not.toBeInTheDocument();
  });

  it("does not fire while a dialog has focus", async () => {
    installFakeApi();
    await openInbox();
    fireEvent.keyDown(document.body, { key: "n" });
    await screen.findByRole("dialog", { name: "Quick add" });

    // A second shortcut while the dialog owns focus must be ignored.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "/" });

    expect(screen.getByRole("searchbox", { name: "Quick search" })).not.toHaveFocus();
  });

  it("lists the registered shortcuts in the hint strip", async () => {
    installFakeApi();
    await openInbox();

    const strip = screen.getByLabelText("Keyboard shortcuts");
    expect(within(strip).getByText("Quick add")).toBeInTheDocument();
    expect(within(strip).getByText("Search")).toBeInTheDocument();
    expect(within(strip).getByText("N")).toBeInTheDocument();
  });
});
