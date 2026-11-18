import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeTask, installFakeApi } from "./test/fakeApi";

// Friday 2026-07-03, local noon (TZ=UTC suite-wide).
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0));
});
afterEach(() => {
  vi.useRealTimers();
});

async function openSmart(name: string): Promise<void> {
  const nav = await screen.findByRole("complementary", { name: "" });
  fireEvent.click(await within(nav).findByRole("button", { name }));
  await screen.findByRole("heading", { name });
}

describe("View button (#445)", () => {
  it("hides Filters, Group by and Sort by behind one View button on a Smart List", async () => {
    installFakeApi();
    render(<App />);
    await openSmart("All");

    expect(screen.queryByRole("combobox", { name: "Group by" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Sort by" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Filters/ })).not.toBeInTheDocument();

    const button = screen.getByRole("button", { name: "View" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);

    const menu = screen.getByRole("dialog", { name: "View" });
    expect(within(menu).getByRole("combobox", { name: "List" })).toHaveValue("");
    expect(within(menu).getByRole("combobox", { name: "Tag" })).toHaveValue("");
    expect(within(menu).getByRole("combobox", { name: "Priority" })).toHaveValue("");
    expect(within(menu).getByRole("combobox", { name: "Group by" })).toHaveValue("section");
    expect(within(menu).getByRole("combobox", { name: "Sort by" })).toBeInTheDocument();
  });

  it("names an active filter on the button and sends it to the API", async () => {
    const api = installFakeApi({
      tasks: [fakeTask("High one", { priority: "high" }), fakeTask("Low one", { priority: "low" })],
    });
    render(<App />);
    await openSmart("All");
    await screen.findByRole("button", { name: "Open details for Low one" });

    fireEvent.click(screen.getByRole("button", { name: "View" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Priority" }), {
      target: { value: "high" },
    });

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Open details for Low one" }),
      ).not.toBeInTheDocument(),
    );
    const button = screen.getByRole("button", { name: "View, 1 filter applied" });
    expect(button).toHaveClass("is-filtered");
    expect(
      api.requests.some(
        (r) =>
          r.method === "GET" && r.url === "/api/v1/tasks?view=all&today=2026-07-03&priority=high",
      ),
    ).toBe(true);

    // Clearing from inside the menu restores the unfiltered list.
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(
      await screen.findByRole("button", { name: "Open details for Low one" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View" })).not.toHaveClass("is-filtered");
  });

  it("closes on Escape, returning focus, and keeps the chosen grouping", async () => {
    installFakeApi({ tasks: [fakeTask("High one", { priority: "high" })] });
    render(<App />);
    await openSmart("All");

    const button = screen.getByRole("button", { name: "View" });
    fireEvent.click(button);
    fireEvent.change(screen.getByRole("combobox", { name: "Group by" }), {
      target: { value: "priority" },
    });
    expect(await screen.findByRole("heading", { name: "High" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "View" })).not.toBeInTheDocument();
    expect(button).toHaveFocus();

    fireEvent.click(button);
    expect(screen.getByRole("combobox", { name: "Group by" })).toHaveValue("priority");
  });

  it("puts Group by and Sort by behind the View button on a List, with no filters", async () => {
    installFakeApi();
    render(<App />);
    fireEvent.click(await screen.findByRole("link", { name: "Inbox" }));
    await screen.findByRole("combobox", { name: "Add a task" });

    expect(screen.queryByRole("combobox", { name: "Sort by" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    const menu = screen.getByRole("dialog", { name: "View" });
    expect(within(menu).getByRole("combobox", { name: "Group by" })).toBeInTheDocument();
    expect(within(menu).getByRole("combobox", { name: "Sort by" })).toBeInTheDocument();
    expect(within(menu).queryByRole("combobox", { name: "Priority" })).not.toBeInTheDocument();
  });
});
