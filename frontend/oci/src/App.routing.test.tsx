import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { pinCalendarClock } from "./test/calendar";
import { fakeList, INBOX, installFakeApi } from "./test/fakeApi";

pinCalendarClock();

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Direct load of a static view's URL", () => {
  it("opens Standup directly at /standup", async () => {
    installFakeApi();
    window.history.replaceState(null, "", "/standup");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Stand-up" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/standup");
  });

  it("does not push a duplicate history entry for the URL that loaded the page", async () => {
    installFakeApi();
    window.history.replaceState(null, "", "/before");
    window.history.pushState(null, "", "/standup");
    const pushSpy = vi.spyOn(window.history, "pushState");

    render(<App />);
    await screen.findByRole("heading", { name: "Stand-up" });

    expect(pushSpy).not.toHaveBeenCalled();

    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe("/before"));
  });

  it("opens Focus directly at /focus, with no task pre-selected", async () => {
    installFakeApi();
    window.history.replaceState(null, "", "/focus");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Focus" })).toBeInTheDocument();
    expect(await screen.findByRole("combobox", { name: "Link" })).toHaveValue("");
    expect(window.location.pathname).toBe("/focus");
  });

  it("opens Focus statistics directly at /focus/stats", async () => {
    installFakeApi();
    window.history.replaceState(null, "", "/focus/stats");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Focus statistics" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/focus/stats");
  });

  it("opens Calendar directly at /calendar, normalizing to /calendar/day", async () => {
    installFakeApi();
    window.history.replaceState(null, "", "/calendar");

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Friday, July 3, 2026" }, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/calendar/day");
  });

  it("opens Calendar directly at /calendar/week", async () => {
    installFakeApi();
    window.history.replaceState(null, "", "/calendar/week");

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Jun 29 – Jul 5, 2026" }, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Week" })).toHaveAttribute("aria-pressed", "true");
    expect(window.location.pathname).toBe("/calendar/week");
  });

  it("opens Calendar directly at /calendar/month", async () => {
    installFakeApi();
    window.history.replaceState(null, "", "/calendar/month");

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "July 2026" }, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Month" })).toHaveAttribute("aria-pressed", "true");
    expect(window.location.pathname).toBe("/calendar/month");
  });

  it("opens Habits directly at /habits", async () => {
    installFakeApi();
    window.history.replaceState(null, "", "/habits");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Habits" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/habits");
  });

  it("opens Settings directly at /settings", async () => {
    installFakeApi();
    window.history.replaceState(null, "", "/settings");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/settings");
  });

  it("opens a blank Search directly at /search", async () => {
    installFakeApi();
    window.history.replaceState(null, "", "/search");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Search" })).toBeInTheDocument();
    expect(await screen.findByText("Type to search")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/search");
  });

  it("redirects an unrecognized path to / and falls back to the Inbox", async () => {
    installFakeApi({ tasks: [] });
    window.history.replaceState(null, "", "/foobar");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Inbox" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });
});

describe("History push/replace while navigating in the app", () => {
  it("pushes a history entry when navigating to a static view from the sidebar", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Inbox" });

    const nav = screen.getByRole("navigation", { name: "Views" });
    await user.click(within(nav).getByRole("link", { name: "Habits" }));

    await screen.findByRole("heading", { name: "Habits" });
    expect(window.location.pathname).toBe("/habits");
  });

  it("replaces the URL back to / when navigating away to a List, without pushing", async () => {
    const groceries = fakeList("Groceries");
    installFakeApi({ lists: [INBOX, groceries] });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Inbox" });

    const nav = screen.getByRole("navigation", { name: "Views" });
    await user.click(within(nav).getByRole("link", { name: "Habits" }));
    await screen.findByRole("heading", { name: "Habits" });
    expect(window.location.pathname).toBe("/habits");

    await user.click(screen.getByRole("button", { name: "Groceries" }));

    await screen.findByRole("heading", { name: "Groceries" });
    expect(window.location.pathname).toBe("/");
  });

  it("pushes /focus/stats from the timer screen, and Back returns to /focus", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Inbox" });

    const nav = screen.getByRole("navigation", { name: "Views" });
    await user.click(within(nav).getByRole("link", { name: "Focus" }));
    await screen.findByRole("heading", { name: "Focus" });

    await user.click(screen.getByRole("link", { name: "Statistics" }));
    await screen.findByRole("heading", { name: "Focus statistics" });
    expect(window.location.pathname).toBe("/focus/stats");

    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe("/focus"));
    await screen.findByRole("heading", { name: "Focus" });
  });

  it("moves Back and Forward between visited static views", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Inbox" });

    const nav = screen.getByRole("navigation", { name: "Views" });
    await user.click(within(nav).getByRole("link", { name: "Habits" }));
    await screen.findByRole("heading", { name: "Habits" });
    await user.click(screen.getByRole("link", { name: "Settings" }));
    await screen.findByRole("heading", { name: "Settings" });

    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe("/habits"));
    await screen.findByRole("heading", { name: "Habits" });

    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    await screen.findByRole("heading", { name: "Inbox" });

    window.history.forward();
    await waitFor(() => expect(window.location.pathname).toBe("/habits"));
    await screen.findByRole("heading", { name: "Habits" });
  });

  it("replaces (never pushes) the URL as the Calendar mode picker is used", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Inbox" });

    const nav = screen.getByRole("navigation", { name: "Views" });
    await user.click(within(nav).getByRole("link", { name: "Calendar" }));
    await screen.findByRole("heading", { name: "Friday, July 3, 2026" });
    expect(window.location.pathname).toBe("/calendar/day");

    await user.click(screen.getByRole("button", { name: "Month" }));
    await screen.findByRole("heading", { name: "July 2026" });
    expect(window.location.pathname).toBe("/calendar/month");

    await user.click(screen.getByRole("button", { name: "Week" }));
    await screen.findByRole("heading", { name: "Jun 29 – Jul 5, 2026" });
    expect(window.location.pathname).toBe("/calendar/week");

    // A single Back leaves the Calendar entirely — mode toggles never added
    // history entries of their own.
    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    await screen.findByRole("heading", { name: "Inbox" });
  });
});
