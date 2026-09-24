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
    expect(within(sidebar).queryByRole("search")).not.toBeInTheDocument();
    expect(within(sidebar).getByRole("button", { name: "Errands" })).toBeInTheDocument();
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

    expect(within(sidebar).getByRole("button", { name: "Errands" })).toBeInTheDocument();
    expect(within(sidebar).getByRole("button", { name: "Reports" })).toBeInTheDocument();
    expect(within(sidebar).getByTitle("Work")).toBeInTheDocument();
    expect(within(sidebar).getByRole("button", { name: "Urgent" })).toBeInTheDocument();
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

  // Below the mobile breakpoint the sidebar is off-canvas, so the header
  // carries its own control. jsdom applies no CSS, so the layout itself isn't
  // observable here — the drawer's state and its dismissal are.
  it("opens the navigation drawer from the header and closes it on a choice", async () => {
    const errands = fakeList("Errands");
    installFakeApi({ lists: [INBOX, errands] });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "All" });

    const menu = screen.getByRole("button", { name: "Show navigation" });
    expect(menu).toHaveAttribute("aria-expanded", "false");

    await user.click(menu);
    expect(screen.getByRole("button", { name: "Show navigation" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    // Picking a destination gets the drawer out of the way.
    const sidebar = screen.getByRole("complementary");
    await user.click(within(sidebar).getByRole("button", { name: "Errands" }));

    expect(await screen.findByRole("heading", { name: "Errands" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show navigation" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  // Issue #170: the drawer used to have no way out but the backdrop —
  // an explicit control closes it too.
  it("closes the drawer from its own explicit close control", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "All" });

    await user.click(screen.getByRole("button", { name: "Show navigation" }));
    expect(screen.getByRole("button", { name: "Show navigation" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    const sidebar = screen.getByRole("complementary");
    await user.click(within(sidebar).getByRole("button", { name: "Close navigation" }));

    expect(screen.getByRole("button", { name: "Show navigation" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  // Issue #290: a drag starting over the scrim used to scroll the list
  // underneath, because nothing locked `main`'s own scroll region while
  // the drawer sat on top of it. `.app` itself never scrolls (`overflow:
  // hidden` in index.css) — `main` is the real scroll region — so it's
  // `main`'s overflow that must lock, not `document.body`'s.
  it("locks main's scroll region while the drawer is open, and restores it on close", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "All" });

    const main = screen.getByRole("main");
    expect(main.style.overflow).toBe("");

    await user.click(screen.getByRole("button", { name: "Show navigation" }));
    expect(main.style.overflow).toBe("hidden");

    await user.click(screen.getByRole("button", { name: "Close navigation" }));
    expect(main.style.overflow).toBe("");
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
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
  });
});
