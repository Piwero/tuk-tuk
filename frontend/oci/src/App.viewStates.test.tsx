import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { installFakeApi } from "./test/fakeApi";

/** Loading, empty and error states on Habits, Goals, Focus and Stand-up
 * (#442): the shared treatment from #441 — busy placeholders while loading,
 * an empty state naming the view's purpose with its primary action, and
 * Retry when the load fails. */

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0));
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

type Api = ReturnType<typeof installFakeApi>;

interface ViewCase {
  link: string;
  heading: string;
  /** The read the view depends on. */
  path: string;
  loading: string;
  emptyHeading: string;
  action: string;
  /** What the primary action opens. */
  opens: () => Promise<HTMLElement>;
  what: string;
}

const cases: ViewCase[] = [
  {
    link: "Habits",
    heading: "Habits",
    path: "/api/v1/habits",
    loading: "Loading habits",
    emptyHeading: "No habits yet",
    action: "Add Habit",
    opens: () => screen.findByLabelText("Name"),
    what: "habits",
  },
  {
    link: "Goals",
    heading: "Goals",
    path: "/api/v1/goals",
    loading: "Loading goals",
    emptyHeading: "No goals yet",
    action: "Add Goal",
    opens: () => screen.findByLabelText("Title"),
    what: "goals",
  },
  {
    link: "Focus",
    heading: "Focus",
    path: "/api/v1/timers",
    loading: "Loading timers",
    emptyHeading: "No timers yet",
    action: "Add Timer",
    opens: () => screen.findByLabelText("Timer name"),
    what: "timers",
  },
  {
    link: "Stand-up",
    heading: "Stand-up",
    path: "/api/v1/stand-up/entries/2026-07-03",
    loading: "Loading stand-up",
    emptyHeading: "No stand-up for this day yet",
    action: "Add a bullet",
    opens: async () => {
      const input = await screen.findByRole("textbox", { name: "Add a Yesterday bullet" });
      await waitFor(() => expect(input).toHaveFocus());
      return input;
    },
    what: "this stand-up",
  },
];

async function open(link: string, heading: string): Promise<void> {
  const nav = await screen.findByRole("navigation", { name: "Views" });
  fireEvent.click(within(nav).getByRole("link", { name: link }));
  await screen.findByRole("heading", { name: heading });
}

function reads(api: Api, path: string): number {
  return api.requests.filter((r) => r.method === "GET" && r.url.split("?")[0] === path).length;
}

describe.each(cases)("$link view states", (c) => {
  it("shows busy placeholders, not the empty state, until it has loaded", async () => {
    let release = (): void => {};
    const api = installFakeApi();
    api.readGate = {
      match: (pathname) => pathname === c.path,
      gate: new Promise<void>((resolve) => {
        release = resolve;
      }),
    };
    render(<App />);
    await open(c.link, c.heading);

    const busy = await screen.findByRole("status", { name: c.loading });
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("heading", { name: c.emptyHeading })).not.toBeInTheDocument();

    release();
    expect(await screen.findByRole("heading", { name: c.emptyHeading })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: c.loading })).not.toBeInTheDocument();
  });

  it("names the view's purpose and offers its primary action when empty", async () => {
    installFakeApi();
    render(<App />);
    await open(c.link, c.heading);

    const heading = await screen.findByRole("heading", { name: c.emptyHeading });
    const empty = heading.closest("section");
    expect(empty).not.toBeNull();
    fireEvent.click(within(empty as HTMLElement).getByRole("button", { name: c.action }));
    expect(await c.opens()).toBeInTheDocument();
  });

  it("offers Retry when the load fails, and Retry reads again", async () => {
    const api = installFakeApi();
    api.failRead = (pathname) => pathname === c.path;
    render(<App />);
    await open(c.link, c.heading);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(`Couldn’t load ${c.what}`);
    expect(screen.queryByRole("heading", { name: c.emptyHeading })).not.toBeInTheDocument();
    const before = reads(api, c.path);

    api.failRead = null;
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("heading", { name: c.emptyHeading })).toBeInTheDocument();
    expect(reads(api, c.path)).toBeGreaterThan(before);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
