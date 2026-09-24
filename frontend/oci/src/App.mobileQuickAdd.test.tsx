import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "./App";
import { pinCalendarClock } from "./test/calendar";
import { installFakeApi } from "./test/fakeApi";

/** jsdom applies no CSS, so the mobile Quick-Add button's fixed positioning
 * and the @media (max-width: 720px) rule that shows it are not observable
 * here (same convention as App.mobileTabBar.test.tsx) — these tests instead
 * pin down that the control exists in the render tree at every route it's
 * meant to cover, opens the same Quick-Add dialog the drawer trigger opens,
 * and carries a distinct accessible name from the drawer trigger so the two
 * "Quick add" controls (present in the DOM at every width, per #287) never
 * collide. */

pinCalendarClock();

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("Mobile Quick-Add button (issue #287)", () => {
  it("renders on the default All view, distinct from the drawer's Quick add trigger", async () => {
    installFakeApi();
    render(<App />);
    await screen.findByRole("heading", { name: "All" });

    expect(screen.getByRole("button", { name: "Quick add task" })).toBeInTheDocument();
    // Both controls exist in the DOM simultaneously (drawer trigger isn't
    // conditionally removed at any width) — distinct accessible names are
    // what keeps them from colliding.
    expect(screen.getByRole("button", { name: "Quick add" })).toBeInTheDocument();
  });

  it("opens the Quick-Add dialog when tapped", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "All" });

    await user.click(screen.getByRole("button", { name: "Quick add task" }));

    expect(screen.getByRole("dialog", { name: "Quick add" })).toBeInTheDocument();
  });

  it("stays present after switching to Today", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "All" });

    const nav = screen.getByRole("navigation", { name: "Primary" });
    await user.click(within(nav).getByRole("button", { name: "Tasks" }));
    await screen.findByRole("heading", { name: "Today" });

    expect(screen.getByRole("button", { name: "Quick add task" })).toBeInTheDocument();
  });

  it("has no accessible-name collision with the drawer trigger while the drawer is open", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "All" });

    await user.click(screen.getByRole("button", { name: "Show navigation" }));

    expect(screen.getAllByRole("button", { name: "Quick add" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Quick add task" })).toHaveLength(1);
  });
});
