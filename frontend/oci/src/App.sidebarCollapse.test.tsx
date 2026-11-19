import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeFolder, fakeList, fakeTag, INBOX, installFakeApi } from "./test/fakeApi";

// Note: fetch stays stubbed across tests (each test installs a fresh fake).
// Restoring the real fetch between tests would let a late in-flight request
// from an unmounting App escape to the network and fail the run.

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Collapsing the sidebar", () => {
  it("collapses to icons and back from the toggle beside the wordmark", async () => {
    const errands = fakeList("Errands");
    installFakeApi({ lists: [INBOX, errands] });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "All" });

    const sidebar = screen.getByRole("complementary");
    expect(within(sidebar).getByRole("search")).toBeInTheDocument();

    await user.click(within(sidebar).getByRole("button", { name: "Collapse sidebar" }));

    // The rail keeps every destination reachable, by icon alone.
    expect(within(sidebar).getByRole("button", { name: "Quick search" })).toBeInTheDocument();
    expect(within(sidebar).getByRole("link", { name: "Errands" })).toBeInTheDocument();
    expect(within(sidebar).getByRole("button", { name: "Quick add" })).toBeInTheDocument();

    await user.click(within(sidebar).getByRole("button", { name: "Expand sidebar" }));
    expect(within(sidebar).getByRole("search")).toBeInTheDocument();
  });

  // #261: collapsing must not turn a List, Folder or Tag into an anonymous
  // glyph — each keeps a discoverable accessible name on the rail.
  it("keeps every List, Folder and Tag discoverably named once collapsed", async () => {
    const folder = fakeFolder("Work");
    const filed = fakeList("Reports", { folder_id: folder.id });
    const loose = fakeList("Errands");
    const tag = fakeTag("Urgent");
    installFakeApi({ lists: [INBOX, filed, loose], folders: [folder], tags: [tag] });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "All" });

    const sidebar = screen.getByRole("complementary");
    await user.click(within(sidebar).getByRole("button", { name: "Collapse sidebar" }));

    expect(within(sidebar).getByRole("link", { name: "Errands" })).toBeInTheDocument();
    expect(within(sidebar).getByRole("link", { name: "Reports" })).toBeInTheDocument();
    expect(within(sidebar).getByTitle("Work")).toBeInTheDocument();
    expect(within(sidebar).getByRole("link", { name: "Urgent" })).toBeInTheDocument();
  });

  // #264: `title` alone only ever reveals on mouse hover — a keyboard user
  // collapsing the sidebar needs the same name back on focus, for every
  // List, Folder and Tag, not just a lucky pointer.
  it("reveals every List, Folder and Tag's name on keyboard focus once collapsed", async () => {
    const folder = fakeFolder("Work");
    const filed = fakeList("Reports", { folder_id: folder.id });
    const tag = fakeTag("Urgent");
    installFakeApi({ lists: [INBOX, filed], folders: [folder], tags: [tag] });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "All" });

    const sidebar = screen.getByRole("complementary");
    await user.click(within(sidebar).getByRole("button", { name: "Collapse sidebar" }));

    // Tree order: the Folder heads its members, so "Work" is reachable
    // before "Reports"; "Urgent" (Tags) comes after both.
    await user.tab();
    while (
      document.activeElement?.getAttribute("title") !== "Work" &&
      document.activeElement !== document.body
    ) {
      await user.tab();
    }
    expect(await within(sidebar).findByRole("tooltip", { name: "Work" })).toBeInTheDocument();

    while (
      document.activeElement?.getAttribute("aria-label") !== "Reports" &&
      document.activeElement !== document.body
    ) {
      await user.tab();
    }
    expect(await within(sidebar).findByRole("tooltip", { name: "Reports" })).toBeInTheDocument();

    while (
      document.activeElement?.getAttribute("aria-label") !== "Urgent" &&
      document.activeElement !== document.body
    ) {
      await user.tab();
    }
    expect(await within(sidebar).findByRole("tooltip", { name: "Urgent" })).toBeInTheDocument();
  });

  it("remembers the choice across a reload", async () => {
    installFakeApi();
    const user = userEvent.setup();
    const first = render(<App />);
    await screen.findByRole("heading", { name: "All" });
    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    first.unmount();

    render(<App />);

    expect(await screen.findByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quick search" })).toBeInTheDocument();
  });
});
