import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { pinCalendarClock } from "./test/calendar";
import { installFakeApi } from "./test/fakeApi";

pinCalendarClock();

afterEach(() => {
  vi.restoreAllMocks();
});

const VIEW_NAMES = ["Tasks", "Calendar", "Habits", "Stand-up", "Focus", "Search"];

/** Tasks has no href (Smart Lists aren't URL-addressable), so it's a plain
 * button; the other five static views are anchors (#143). */
function getNavItem(nav: HTMLElement, name: string): HTMLElement {
  return name === "Tasks"
    ? within(nav).getByRole("button", { name })
    : within(nav).getByRole("link", { name });
}

// Regression coverage for issue #160: a growing text label on the active
// destination used to push the row past the sidebar edge, clipping
// whichever item landed last — Search, on nearly every page. The row is
// now icon-only at a fixed width, so nothing should ever push past it.
describe("Sidebar top nav (issue #160)", () => {
  it("keeps all six destinations present and reachable with Tasks active", async () => {
    installFakeApi();
    render(<App />);
    await screen.findByRole("heading", { name: "All" });

    const nav = screen.getByRole("navigation", { name: "Views" });
    for (const name of VIEW_NAMES) {
      expect(getNavItem(nav, name)).toBeInTheDocument();
    }
    expect(getNavItem(nav, "Tasks")).toHaveClass("selected");
    for (const name of VIEW_NAMES.filter((n) => n !== "Tasks")) {
      expect(getNavItem(nav, name)).not.toHaveClass("selected");
    }
  });

  it("keeps all six destinations present and reachable with Stand-up active, including Search", async () => {
    installFakeApi();
    window.history.replaceState(null, "", "/standup");
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Stand-up" });

    const nav = screen.getByRole("navigation", { name: "Views" });
    for (const name of VIEW_NAMES) {
      expect(getNavItem(nav, name)).toBeInTheDocument();
    }
    expect(getNavItem(nav, "Stand-up")).toHaveClass("selected");

    // Search used to be clipped entirely with a long active label like
    // Stand-up's — it must still be reachable.
    await user.click(getNavItem(nav, "Search"));
    await screen.findByRole("heading", { name: "Search" });
    expect(window.location.pathname).toBe("/search");
  });

  it("shows no destination as active when Settings is open, without hiding any", async () => {
    installFakeApi();
    window.history.replaceState(null, "", "/settings");
    render(<App />);
    await screen.findByRole("heading", { name: "Settings" });

    const nav = screen.getByRole("navigation", { name: "Views" });
    for (const name of VIEW_NAMES) {
      expect(getNavItem(nav, name)).toBeInTheDocument();
      expect(getNavItem(nav, name)).not.toHaveClass("selected");
    }
  });

  it("marks Search active when it is the loaded route", async () => {
    installFakeApi();
    window.history.replaceState(null, "", "/search");
    render(<App />);
    await screen.findByRole("heading", { name: "Search" });

    const nav = screen.getByRole("navigation", { name: "Views" });
    expect(getNavItem(nav, "Search")).toHaveClass("selected");
    for (const name of VIEW_NAMES.filter((n) => n !== "Search")) {
      expect(getNavItem(nav, name)).not.toHaveClass("selected");
    }
  });

  it("shows each feature item's label as visible text (issue #194)", async () => {
    installFakeApi();
    window.history.replaceState(null, "", "/standup");
    render(<App />);
    await screen.findByRole("heading", { name: "Stand-up" });

    // The vertical nav is readable, not guessed from a glyph: every item
    // renders its label as visible text, not only as an accessible name.
    const nav = screen.getByRole("navigation", { name: "Views" });
    for (const name of VIEW_NAMES) {
      expect(within(nav).getByText(name)).toBeInTheDocument();
    }
  });
});
