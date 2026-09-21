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
