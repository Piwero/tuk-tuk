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

  it("keeps footer actions behind one disclosure", async () => {
    installFakeApi();
    render(<App onLogout={() => undefined} />);
    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("App menu"));
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Switch to .* mode/ })).toBeInTheDocument();
  });
});
