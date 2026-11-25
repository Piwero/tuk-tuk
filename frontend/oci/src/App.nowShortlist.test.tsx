import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeTask, installFakeApi } from "./test/fakeApi";

/* Now shortlist (issue #551): a few ordered alternatives beside Now. */

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 3, 12));
});
afterEach(() => vi.useRealTimers());

function openToday(): void {
  window.history.replaceState(null, "", "/today");
  render(<App />);
}

const shortlist = () => screen.findByRole("region", { name: "Shortlist" });
const entryTitles = async (): Promise<string[]> =>
  within(await shortlist())
    .queryAllByRole("listitem")
    .map((li) => li.querySelector(".now-shortlist-title")?.textContent ?? "");

async function add(title: string): Promise<void> {
  fireEvent.click(within(await shortlist()).getByRole("button", { name: "Add to shortlist" }));
  const dialog = await screen.findByRole("dialog", { name: "Add to the shortlist" });
  fireEvent.click(within(dialog).getByRole("button", { name: title }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

const shortlistWrites = (api: ReturnType<typeof installFakeApi>) =>
  api.requests.filter((r) => r.method !== "GET").map((r) => [r.method, r.url, r.body] as const);

describe("Now shortlist", () => {
  it("adds Tasks in order through the picker, without changing them", async () => {
    const a = fakeTask("Alpha", { due_date: "2026-07-03T00:00:00Z", is_all_day: true });
    const b = fakeTask("Bravo");
    const api = installFakeApi({ nowEnabled: true, tasks: [a, b] });
    openToday();

    await add("Bravo");
    await add("Alpha");

    await waitFor(async () => expect(await entryTitles()).toEqual(["Bravo", "Alpha"]));
    expect(shortlistWrites(api)).toEqual([
      ["PUT", "/api/v1/now/shortlist", { task_ids: [b.id] }],
      ["PUT", "/api/v1/now/shortlist", { task_ids: [b.id, a.id] }],
    ]);
  });

  it("never offers a Task already listed or already Now", async () => {
    const now = fakeTask("Current");
    const listed = fakeTask("Listed");
    const free = fakeTask("Free");
    installFakeApi({
      nowEnabled: true,
      tasks: [now, listed, free],
      nowTaskId: now.id,
      nowShortlist: [listed.id],
    });
    openToday();
    await waitFor(async () => expect(await entryTitles()).toEqual(["Listed"]));

    fireEvent.click(within(await shortlist()).getByRole("button", { name: "Add to shortlist" }));
    const dialog = await screen.findByRole("dialog", { name: "Add to the shortlist" });
    expect(within(dialog).getByRole("button", { name: "Free" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Listed" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Current" })).not.toBeInTheDocument();
  });

  it("reorders with Move up and Move down buttons", async () => {
    const a = fakeTask("A");
    const b = fakeTask("B");
    const c = fakeTask("C");
    const api = installFakeApi({
      nowEnabled: true,
      tasks: [a, b, c],
      nowShortlist: [a.id, b.id, c.id],
    });
    openToday();
    await waitFor(async () => expect(await entryTitles()).toEqual(["A", "B", "C"]));

    fireEvent.click(within(await shortlist()).getByRole("button", { name: "Move C up" }));
    await waitFor(async () => expect(await entryTitles()).toEqual(["A", "C", "B"]));
    fireEvent.click(within(await shortlist()).getByRole("button", { name: "Move A down" }));
    await waitFor(async () => expect(await entryTitles()).toEqual(["C", "A", "B"]));

    expect(within(await shortlist()).getByRole("button", { name: "Move C up" })).toBeDisabled();
    expect(within(await shortlist()).getByRole("button", { name: "Move B down" })).toBeDisabled();
    expect(shortlistWrites(api).map(([, , body]) => body)).toEqual([
      { task_ids: [a.id, c.id, b.id] },
      { task_ids: [c.id, a.id, b.id] },
    ]);
  });

  it("shows three entries and expands to the rest", async () => {
    const tasks = ["One", "Two", "Three", "Four", "Five"].map((t) => fakeTask(t));
    installFakeApi({ nowEnabled: true, tasks, nowShortlist: tasks.map((t) => t.id) });
    openToday();
    await waitFor(async () => expect(await entryTitles()).toEqual(["One", "Two", "Three"]));

    const more = within(await shortlist()).getByRole("button", { name: "Show 2 more" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);

    expect(await entryTitles()).toEqual(["One", "Two", "Three", "Four", "Five"]);
    fireEvent.click(within(await shortlist()).getByRole("button", { name: "Show fewer" }));
    expect(await entryTitles()).toEqual(["One", "Two", "Three"]);
  });

  it("offers no expand control with three or fewer", async () => {
    const tasks = ["One", "Two", "Three"].map((t) => fakeTask(t));
    installFakeApi({ nowEnabled: true, tasks, nowShortlist: tasks.map((t) => t.id) });
    openToday();
    await waitFor(async () => expect(await entryTitles()).toHaveLength(3));
    expect(within(await shortlist()).queryByRole("button", { name: /more/ })).toBeNull();
  });

  it("promotes an entry to Now, taking it off the shortlist", async () => {
    const current = fakeTask("Current");
    const next = fakeTask("Next");
    const other = fakeTask("Other");
    const api = installFakeApi({
      nowEnabled: true,
      tasks: [current, next, other],
      nowTaskId: current.id,
      nowShortlist: [next.id, other.id],
    });
    openToday();
    await waitFor(async () => expect(await entryTitles()).toEqual(["Next", "Other"]));

    fireEvent.click(within(await shortlist()).getByRole("button", { name: "Make Next Now" }));

    const panel = await screen.findByRole("region", { name: "Now" });
    expect(await within(panel).findByText("Next", { selector: ".now-title" })).toBeInTheDocument();
    await waitFor(async () => expect(await entryTitles()).toEqual(["Other"]));
    expect(shortlistWrites(api)).toEqual([["PUT", "/api/v1/now", { task_id: next.id }]]);
  });

  it("removes an entry", async () => {
    const a = fakeTask("Keep");
    const b = fakeTask("Drop");
    const api = installFakeApi({ nowEnabled: true, tasks: [a, b], nowShortlist: [a.id, b.id] });
    openToday();
    await waitFor(async () => expect(await entryTitles()).toEqual(["Keep", "Drop"]));

    fireEvent.click(
      within(await shortlist()).getByRole("button", { name: "Remove Drop from shortlist" }),
    );

    await waitFor(async () => expect(await entryTitles()).toEqual(["Keep"]));
    expect(shortlistWrites(api)).toEqual([["PUT", "/api/v1/now/shortlist", { task_ids: [a.id] }]]);
  });

  // #555 browser check: a row's action removed the focused button, dropping
  // keyboard focus to <body>.
  describe("keeps keyboard focus in the shortlist", () => {
    const addButton = async () =>
      within(await shortlist()).getByRole("button", { name: "Add to shortlist" });

    it("after removing an entry", async () => {
      const a = fakeTask("Keep");
      const b = fakeTask("Drop");
      installFakeApi({ nowEnabled: true, tasks: [a, b], nowShortlist: [a.id, b.id] });
      openToday();
      await waitFor(async () => expect(await entryTitles()).toEqual(["Keep", "Drop"]));

      const remove = within(await shortlist()).getByRole("button", {
        name: "Remove Drop from shortlist",
      });
      remove.focus();
      fireEvent.click(remove);

      await waitFor(async () => expect(await entryTitles()).toEqual(["Keep"]));
      expect(document.activeElement).toBe(await addButton());
    });

    it("after promoting an entry to Now", async () => {
      const current = fakeTask("Current");
      const next = fakeTask("Next");
      installFakeApi({
        nowEnabled: true,
        tasks: [current, next],
        nowTaskId: current.id,
        nowShortlist: [next.id],
      });
      openToday();
      await waitFor(async () => expect(await entryTitles()).toEqual(["Next"]));

      const promote = within(await shortlist()).getByRole("button", { name: "Make Next Now" });
      promote.focus();
      fireEvent.click(promote);

      await waitFor(async () => expect(await entryTitles()).toEqual([]));
      expect(document.activeElement).toBe(await addButton());
    });

    it("after moving an entry to the end, onto the other move button", async () => {
      const a = fakeTask("First");
      const b = fakeTask("Second");
      installFakeApi({ nowEnabled: true, tasks: [a, b], nowShortlist: [a.id, b.id] });
      openToday();
      await waitFor(async () => expect(await entryTitles()).toEqual(["First", "Second"]));

      const down = within(await shortlist()).getByRole("button", { name: "Move First down" });
      down.focus();
      fireEvent.click(down);

      await waitFor(async () => expect(await entryTitles()).toEqual(["Second", "First"]));
      expect(document.activeElement).toBe(
        within(await shortlist()).getByRole("button", { name: "Move First up" }),
      );
    });
  });

  it("leaves every Task reachable in Today", async () => {
    const a = fakeTask("Listed today", { due_date: "2026-07-03T00:00:00Z", is_all_day: true });
    installFakeApi({ nowEnabled: true, tasks: [a], nowShortlist: [a.id] });
    openToday();
    await waitFor(async () => expect(await entryTitles()).toEqual(["Listed today"]));
    expect(screen.getAllByText("Listed today").length).toBeGreaterThan(1);
  });
});
