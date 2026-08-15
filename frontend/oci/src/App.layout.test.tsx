import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeTask, installFakeApi } from "./test/fakeApi";

/** These are structural/DOM-level checks for the shell's independent-scroll
 * layout (issue #159). jsdom doesn't apply the stylesheet or compute layout,
 * so the actual `overflow`/`height` CSS that makes each region scroll on its
 * own is only verifiable by eye in a real browser — these tests instead
 * pin down the DOM shape the CSS depends on: the sidebar's Settings/Log out
 * footer sits outside its scrollable list-tree region, and the task detail
 * panel is a sibling of (not nested inside) the scrollable main region. */

// Note: fetch stays stubbed across tests (each test installs a fresh fake).
afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("App shell layout", () => {
  it("keeps the sidebar's Settings/Log out footer outside its scrollable region", async () => {
    installFakeApi();
    render(<App onLogout={() => {}} />);

    const settingsLink = await screen.findByRole("link", { name: "Settings" });
    const sidebar = settingsLink.closest(".sidebar");
    expect(sidebar).not.toBeNull();
    const scrollRegion = sidebar?.querySelector(".sidebar-scroll");
    expect(scrollRegion).not.toBeNull();

    // The list tree (a long list of Lists) lives inside the scroll region...
    const listsNav = within(sidebar as HTMLElement).getByRole("navigation", { name: "Lists" });
    expect(scrollRegion).toContainElement(listsNav);

    // ...but Settings and Log out are pinned outside it, so scrolling the
    // list tree never carries them away.
    expect(scrollRegion).not.toContainElement(settingsLink);
    const logoutButton = screen.getByRole("button", { name: "Log out" });
    expect(scrollRegion).not.toContainElement(logoutButton);
  });

  it("renders main content and the task detail panel as independent siblings", async () => {
    installFakeApi({ tasks: [fakeTask("Write report")] });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Open details for Write report" }));
    const detailPanel = await screen.findByRole("complementary", { name: "Task details" });
    const main = document.querySelector("main");
    expect(main).not.toBeNull();

    // The detail panel scrolls on its own (issue #159): it must sit beside
    // `main`, not inside it, so expanding it never grows main's box.
    expect(main).not.toContainElement(detailPanel);
    expect(detailPanel.parentElement).toBe(main?.parentElement);
  });
});
