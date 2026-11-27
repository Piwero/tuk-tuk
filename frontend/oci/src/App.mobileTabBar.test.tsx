import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { App } from "./App";
import { pinCalendarClock } from "./test/calendar";
import { fakeFolder, fakeList, fakeTag, fakeUser, INBOX, installFakeApi } from "./test/fakeApi";

/** jsdom applies no CSS, so the bottom tab bar's fixed positioning and the
 * @media (max-width: 720px) rule that shows it are not observable here —
 * these tests pin down the tab bar's DOM structure and behaviour: which
 * destinations it exposes, that tapping one navigates, and that More opens a
 * sheet holding everything else (issue #462, replacing the drawer). */

pinCalendarClock();

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

// Plain buttons throughout (#170), not anchors, and named so they never
// collide with the sidebar's controls, which render at every width.
const TAB_NAMES = ["Today tab", "Calendar", "Quick add task", "Habits", "More"];

function tabBar(): HTMLElement {
  return screen.getByRole("navigation", { name: "Primary" });
}

function getTab(name: string): HTMLElement {
  return within(tabBar()).getByRole("button", { name });
}

async function ready(): Promise<void> {
  await screen.findByRole("heading", { name: "All" });
}

describe("Mobile bottom tab bar (issues #170, #462)", () => {
  it("holds Today, Calendar, a centre Quick-Add, Habits and More, in that order", async () => {
    installFakeApi();
    render(<App />);
    await ready();

    const names = within(tabBar())
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? button.textContent);
    expect(names).toEqual(TAB_NAMES);
    expect(within(tabBar()).queryByRole("link")).toBeNull();
    // All lives under More's Lists tree, so More is the current tab.
    expect(getTab("More")).toHaveAttribute("aria-current", "page");
  });

  it("keeps tab names distinct from the sidebar's controls", async () => {
    installFakeApi();
    render(<App />);
    await ready();

    for (const name of TAB_NAMES) {
      expect(screen.getAllByRole("button", { name })).toHaveLength(1);
    }
  });

  it("opens Quick-Add from the centre tab and has no floating button", async () => {
    installFakeApi();
    const user = userEvent.setup();
    const { container } = render(<App />);
    await ready();

    expect(container.querySelector(".mobile-quick-add")).toBeNull();
    await user.click(getTab("Quick add task"));
    expect(screen.getByRole("dialog", { name: "Quick add" })).toBeInTheDocument();
  });

  it("navigates to Calendar and Habits and back to Today", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await ready();

    await user.click(getTab("Calendar"));
    await screen.findByRole("heading", { name: "Friday, July 3, 2026" }, { timeout: 10_000 });
    await waitFor(() => expect(window.location.pathname).toBe("/calendar/day"));
    expect(getTab("Calendar")).toHaveAttribute("aria-current", "page");

    await user.click(getTab("Habits"));
    await screen.findByRole("heading", { name: "Habits" });
    expect(getTab("Habits")).toHaveAttribute("aria-current", "page");

    await user.click(getTab("Today tab"));
    await screen.findByRole("heading", { name: "Today" });
    expect(getTab("Today tab")).toHaveAttribute("aria-current", "page");
  });

  it("drops the tab of a feature disabled in Settings", async () => {
    installFakeApi({
      sectionSettings: {
        calendar: false,
        goals: true,
        habits: false,
        focus: true,
        assistant: true,
      },
    });
    render(<App />);
    await ready();

    // Section settings load independently of the task list, so wait for
    // them to apply rather than asserting on the first render.
    await waitFor(() => {
      expect(within(tabBar()).queryByRole("button", { name: "Calendar" })).toBeNull();
      expect(within(tabBar()).queryByRole("button", { name: "Habits" })).toBeNull();
    });
    expect(getTab("More")).toBeInTheDocument();
  });

  it("has no navigation drawer toggle", async () => {
    installFakeApi();
    render(<App />);
    await ready();

    expect(screen.queryByRole("button", { name: "Show navigation" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close navigation" })).toBeNull();
  });
});

describe("More sheet (issue #462)", () => {
  async function openMore(): Promise<HTMLElement> {
    const user = userEvent.setup();
    await user.click(getTab("More"));
    expect(getTab("More")).toHaveAttribute("aria-expanded", "true");
    return screen.getByRole("dialog", { name: "More" });
  }

  it("reaches the remaining destinations", async () => {
    installFakeApi({ assistantAvailable: true });
    render(<App />);
    await ready();

    const sheet = await openMore();
    for (const name of ["Goals", "Focus", "Stand-up", "Assistant", "Search", "My account"]) {
      expect(within(sheet).getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("navigates to a destination and closes", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await ready();

    const sheet = await openMore();
    await user.click(within(sheet).getByRole("button", { name: "Goals" }));

    await screen.findByRole("heading", { name: "Goals" });
    expect(screen.queryByRole("dialog", { name: "More" })).toBeNull();
    expect(getTab("More")).toHaveAttribute("aria-current", "page");
  });

  it("opens Search from the sheet", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await ready();

    const sheet = await openMore();
    await user.click(within(sheet).getByRole("button", { name: "Search" }));
    await waitFor(() => expect(window.location.pathname).toBe("/search"));
  });

  it("lists every List, Folder and Tag, and opens one", async () => {
    const work = fakeFolder("Work");
    const errands = fakeList("Errands");
    const filed = fakeList("Reports", { folder_id: work.id });
    const urgent = fakeTag("urgent");
    installFakeApi({ lists: [INBOX, errands, filed], folders: [work], tags: [urgent] });
    const user = userEvent.setup();
    render(<App />);
    await ready();

    const sheet = await openMore();
    const lists = within(sheet).getByRole("navigation", { name: "Lists" });
    for (const name of ["Inbox", "Errands", "Work", "Reports"]) {
      expect(await within(lists).findByRole("button", { name })).toBeInTheDocument();
    }
    const tags = within(sheet).getByRole("navigation", { name: "Tags" });
    expect(within(tags).getByRole("button", { name: "urgent" })).toBeInTheDocument();

    await user.click(within(lists).getByRole("button", { name: "Reports" }));
    await screen.findByRole("heading", { level: 1, name: /Reports/ });
    await waitFor(() => expect(window.location.pathname).toBe(`/lists/${filed.id}`));

    const again = await openMore();
    await user.click(
      within(within(again).getByRole("navigation", { name: "Tags" })).getByRole("button", {
        name: "urgent",
      }),
    );
    await waitFor(() => expect(window.location.pathname).toBe(`/tags/${urgent.id}`));
  });

  it("leaves out destinations disabled in Settings", async () => {
    installFakeApi({
      standupEnabled: false,
      sectionSettings: {
        calendar: true,
        goals: false,
        habits: true,
        focus: false,
        assistant: false,
      },
    });
    render(<App />);
    await ready();

    const sheet = await openMore();
    for (const name of ["Goals", "Focus", "Stand-up", "Assistant"]) {
      expect(within(sheet).queryByRole("button", { name })).toBeNull();
    }
    expect(within(sheet).getByRole("button", { name: "My account" })).toBeInTheDocument();
  });

  it("is headed by the signed-in account and its entries (#473)", async () => {
    let loggedOut = false;
    installFakeApi({ users: [fakeUser("rafa", { email: "rafa@example.org", is_admin: true })] });
    const user = userEvent.setup();
    render(<App onLogout={() => (loggedOut = true)} />);
    await ready();

    const sheet = await openMore();
    const account = within(sheet).getByRole("region", { name: "Account" });
    expect(await within(account).findByText("rafa")).toBeInTheDocument();
    expect(within(account).getByText("Admin")).toBeInTheDocument();
    expect(within(account).getByText("rafa@example.org")).toBeInTheDocument();
    const entries = Array.from(account.querySelectorAll("button"), (entry) => entry.textContent);
    expect(entries).toEqual(["My account", "Users", "Dark mode", "Log out"]);
    // It heads the sheet, above the other destinations.
    expect(
      account.compareDocumentPosition(
        within(sheet).getByRole("navigation", { name: "More destinations" }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(within(account).getByRole("switch", { name: "Dark mode" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(within(account).getByRole("switch", { name: "Dark mode" })).toBeChecked();

    await user.click(within(account).getByRole("button", { name: "Users" }));
    await waitFor(() => expect(window.location.pathname).toBe("/settings/users"));
    expect(screen.queryByRole("dialog", { name: "More" })).toBeNull();

    const again = await openMore();
    await user.click(within(again).getByRole("button", { name: "Log out" }));
    expect(loggedOut).toBe(true);
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
  });

  it("offers a Member My account but no Users (#473)", async () => {
    installFakeApi({ users: [fakeUser("bea")] });
    const user = userEvent.setup();
    render(<App />);
    await ready();

    const account = within(await openMore()).getByRole("region", { name: "Account" });
    expect(await within(account).findByText("bea")).toBeInTheDocument();
    expect(within(account).queryByRole("button", { name: "Users" })).toBeNull();
    await user.click(within(account).getByRole("button", { name: "My account" }));
    await waitFor(() => expect(window.location.pathname).toBe("/settings/account"));
  });
});
