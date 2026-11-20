import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { installFakeApi } from "./test/fakeApi";

describe("Sidebar navigation (#451)", () => {
  it("combines destinations and puts All above Inbox under Lists", async () => {
    installFakeApi();
    window.history.replaceState(null, "", "/today");
    render(<App />);
    await screen.findByRole("heading", { name: "Today" });
    const nav = screen.getByRole("navigation", { name: "Views" });
    expect(
      within(nav)
        .getAllByRole("button")
        .map((item) => item.getAttribute("aria-label")),
    ).toEqual(["Today", "Next 7 Days"]);
    expect(
      within(nav)
        .getAllByRole("link")
        .map((item) => item.textContent),
    ).toEqual(["Calendar", "Habits", "Goals", "Focus", "Stand-up"]);
    expect(within(nav).getByRole("button", { name: "Today" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByRole("navigation", { name: "Smart Lists" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("button", { name: "Tasks" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Search" })).not.toBeInTheDocument();
    const lists = screen.getByRole("navigation", { name: "Lists" });
    fireEvent.click(within(lists).getByRole("button", { name: "All" }));
    await screen.findByRole("heading", { name: "All" });
    expect(within(lists).getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("opens palette from search and slash in collapsed rail", async () => {
    installFakeApi();
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Quick search" }));
    expect(await screen.findByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    fireEvent.keyDown(document, { key: "/" });
    expect(await screen.findByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
  });

  it("leaves Dark mode, Settings and Log out to the one user menu (#473)", async () => {
    installFakeApi();
    render(<App onLogout={() => undefined} />);
    await screen.findByRole("button", { name: "Account menu" });

    const sidebar = screen.getByRole("complementary");
    expect(within(sidebar).queryByRole("button", { name: "App menu" })).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
    expect(within(sidebar).queryByRole("button", { name: "Log out" })).not.toBeInTheDocument();
    expect(
      within(sidebar).queryByRole("button", { name: /Switch to .* mode/ }),
    ).not.toBeInTheDocument();
  });
});
