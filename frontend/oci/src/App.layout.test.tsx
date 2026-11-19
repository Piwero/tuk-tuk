import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeTask, installFakeApi } from "./test/fakeApi";

/** These are structural/DOM-level checks for the shell's independent-scroll
 * layout (issue #159). jsdom doesn't apply the stylesheet or compute layout,
 * so the actual `overflow`/`height` CSS that makes each region scroll on its
 * own is only verifiable by eye in a real browser — these tests instead
 * pin down the DOM shape the CSS depends on: the task detail panel is a
 * sibling of (not nested inside) the scrollable main region. The sidebar's
 * Settings/Log out footer moved to the user menu (#473). */

// Note: fetch stays stubbed across tests (each test installs a fresh fake).
afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("App shell layout", () => {
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
