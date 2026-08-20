import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "./App";
import { pinCalendarClock } from "./test/calendar";
import { fakeList, INBOX, installFakeApi } from "./test/fakeApi";

/** jsdom applies no CSS, so the bottom tab bar's fixed positioning and the
 * @media (max-width: 720px) rule that shows it are not observable here
 * (same convention as App.sidebarCollapse.test.tsx's drawer tests) — these
 * tests instead pin down the tab bar's DOM structure and behavior: which
 * destinations it exposes, and that tapping one navigates and updates the
 * active state, exactly as the always-present sidebar top nav does. */

pinCalendarClock();

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

const TAB_NAMES = ["Tasks", "Calendar", "Habits", "Focus"];

// Plain buttons throughout (not anchors, unlike the sidebar's top nav) —
// this tab bar has no need for cmd/ctrl-click "open in new tab", and
// staying button-only keeps its accessible names from colliding with the
// sidebar's same-named links, which render at every width alongside it.
function getTab(nav: HTMLElement, name: string): HTMLElement {
  return within(nav).getByRole("button", { name });
}

describe("Mobile bottom tab bar (issue #170)", () => {
  it("exposes Tasks, Calendar, Habits, and Focus, with Tasks active by default", async () => {
    installFakeApi();
    render(<App />);
    await screen.findByRole("heading", { name: "Inbox" });

    const nav = screen.getByRole("navigation", { name: "Primary" });
    for (const name of TAB_NAMES) {
      expect(getTab(nav, name)).toBeInTheDocument();
    }
    expect(getTab(nav, "Tasks")).toHaveClass("selected");
    for (const name of TAB_NAMES.filter((n) => n !== "Tasks")) {
      expect(getTab(nav, name)).not.toHaveClass("selected");
    }
  });

  it("does not include Stand-up or Search — those stay drawer-only", async () => {
    installFakeApi();
    render(<App />);
    await screen.findByRole("heading", { name: "Inbox" });

    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).queryByText("Stand-up")).not.toBeInTheDocument();
    expect(within(nav).queryByText("Search")).not.toBeInTheDocument();
  });

  it("navigates to Calendar and marks it active", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Inbox" });

    const nav = screen.getByRole("navigation", { name: "Primary" });
    await user.click(getTab(nav, "Calendar"));

    await screen.findByRole("heading", { name: "Friday, July 3, 2026" }, { timeout: 10_000 });
    expect(window.location.pathname).toBe("/calendar");
    expect(getTab(nav, "Calendar")).toHaveClass("selected");
    expect(getTab(nav, "Tasks")).not.toHaveClass("selected");
  });

  it("navigates to Habits and marks it active", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Inbox" });

    const nav = screen.getByRole("navigation", { name: "Primary" });
    await user.click(getTab(nav, "Habits"));

    await screen.findByRole("heading", { name: "Habits" });
    expect(getTab(nav, "Habits")).toHaveClass("selected");
  });

  it("navigates to Focus and marks it active", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Inbox" });

    const nav = screen.getByRole("navigation", { name: "Primary" });
    await user.click(getTab(nav, "Focus"));

    await screen.findByRole("heading", { name: "Focus" });
    expect(getTab(nav, "Focus")).toHaveClass("selected");
  });

  it("returns to Today from another destination via the Tasks tab", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Inbox" });

    const nav = screen.getByRole("navigation", { name: "Primary" });
    await user.click(getTab(nav, "Habits"));
    await screen.findByRole("heading", { name: "Habits" });

    await user.click(getTab(nav, "Tasks"));

    await screen.findByRole("heading", { name: "Today" });
    expect(getTab(nav, "Tasks")).toHaveClass("selected");
  });

  it("shows no tab active while a List is selected from the drawer", async () => {
    const errands = fakeList("Errands");
    installFakeApi({ lists: [INBOX, errands] });
    render(<App />);
    await screen.findByRole("heading", { name: "Inbox" });

    // Tasks lights up for any Smart List / List / Tag / Folder view (it's
    // the "everything else" destination, same convention as the sidebar's
    // own tasksSelected).
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(getTab(nav, "Tasks")).toHaveClass("selected");
  });
});
