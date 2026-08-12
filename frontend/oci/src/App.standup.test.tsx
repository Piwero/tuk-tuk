import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeStandupEntry, fakeTask, installFakeApi } from "./test/fakeApi";

// All tests pin the clock to Friday 2026-07-03, local noon, so "today" is
// deterministic in any timezone.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 3, 12, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
});

async function openStandup(): Promise<void> {
  const nav = await screen.findByRole("navigation", { name: "Views" });
  fireEvent.click(within(nav).getByRole("link", { name: "Stand-up" }));
  await screen.findByRole("heading", { name: "Stand-up" });
}

async function addBullet(label: string, text: string): Promise<void> {
  const input = (await screen.findByRole("textbox", {
    name: `Add a ${label} bullet`,
  })) as HTMLInputElement;
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
  await waitFor(() => {
    expect(
      within(screen.getByRole("list", { name: `${label} bullets` })).getByText(text),
    ).toBeInTheDocument();
  });
}

describe("Stand-up", () => {
  it("opens from the sidebar defaulting to today, with no entry yet", async () => {
    const api = installFakeApi();
    render(<App />);

    await openStandup();

    await waitFor(() => {
      expect(
        api.requests.some(
          (r) => r.method === "GET" && r.url === "/api/v1/stand-up/entries/2026-07-03",
        ),
      ).toBe(true);
    });
    // No entry yet on a fresh date: every section starts empty.
    expect(screen.getByRole("list", { name: "Yesterday bullets" })).toBeEmptyDOMElement();
    expect(screen.getByRole("list", { name: "Today bullets" })).toBeEmptyDOMElement();
    expect(screen.getByRole("list", { name: "Blockers bullets" })).toBeEmptyDOMElement();
    expect(screen.getByRole("region", { name: "Yesterday" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Blockers" })).toBeInTheDocument();
  });

  it("saving the first bullet lazily persists the entry and lists it in history", async () => {
    const api = installFakeApi();
    render(<App />);
    await openStandup();

    await addBullet("Today", "Ship the stand-up feature");

    await waitFor(() => {
      const today = screen.getByRole("list", { name: "Today bullets" });
      expect(within(today).getByText("Ship the stand-up feature")).toBeInTheDocument();
    });
    expect(api.standupEntries).toHaveLength(1);
    expect(api.standupEntries[0]?.bullets).toHaveLength(1);

    const history = await screen.findByRole("list", { name: "Past stand-ups" });
    expect(within(history).getByText("Friday: 03/07/26")).toBeInTheDocument();
  });

  it("adds bullets independently to each of the three sections", async () => {
    installFakeApi();
    render(<App />);
    await openStandup();

    await addBullet("Yesterday", "Reviewed PRs");
    await addBullet("Today", "Ship the stand-up feature");
    await addBullet("Blockers", "Waiting on design review");

    expect(
      within(screen.getByRole("list", { name: "Yesterday bullets" })).getByText("Reviewed PRs"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: "Today bullets" })).getByText(
        "Ship the stand-up feature",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: "Blockers bullets" })).getByText(
        "Waiting on design review",
      ),
    ).toBeInTheDocument();
  });

  it("renames a bullet in place", async () => {
    const api = installFakeApi();
    render(<App />);
    await openStandup();
    await addBullet("Blockers", "Waiting on design");

    fireEvent.click(
      await screen.findByRole("button", { name: "Edit Blockers bullet Waiting on design" }),
    );
    const editField = screen.getByRole("textbox", { name: "Edit Blockers bullet" });
    fireEvent.change(editField, { target: { value: "Waiting on design review" } });
    fireEvent.blur(editField);

    await waitFor(() => {
      expect(
        within(screen.getByRole("list", { name: "Blockers bullets" })).getByText(
          "Waiting on design review",
        ),
      ).toBeInTheDocument();
    });
    expect(api.standupEntries[0]?.bullets[0]?.text).toBe("Waiting on design review");
  });

  it("deletes a bullet", async () => {
    const api = installFakeApi();
    render(<App />);
    await openStandup();
    await addBullet("Today", "Oops");

    fireEvent.click(await screen.findByRole("button", { name: "Delete Today bullet Oops" }));

    await waitFor(() => expect(screen.queryByText("Oops")).not.toBeInTheDocument());
    expect(api.standupEntries[0]?.bullets).toHaveLength(0);
  });

  it("navigating to a different date shows its own empty, editable form", async () => {
    installFakeApi({
      standupEntries: [
        fakeStandupEntry("2026-07-01", {
          bullets: [{ id: 1, section: "today", text: "Old work", sort_order: 1024 }],
        }),
      ],
    });
    render(<App />);
    await openStandup();

    fireEvent.change(screen.getByLabelText("Stand-up date"), {
      target: { value: "2026-07-01" },
    });

    await waitFor(() => {
      expect(
        within(screen.getByRole("list", { name: "Today bullets" })).getByText("Old work"),
      ).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Stand-up date"), {
      target: { value: "2026-06-15" },
    });

    await waitFor(() => {
      expect(screen.queryByText("Old work")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("list", { name: "Today bullets" })).toBeEmptyDOMElement();
  });

  it("selecting a date from the history list loads its detail", async () => {
    installFakeApi({
      standupEntries: [
        fakeStandupEntry("2026-07-01", {
          bullets: [{ id: 1, section: "yesterday", text: "Reviewed PRs", sort_order: 1024 }],
        }),
      ],
    });
    render(<App />);
    await openStandup();

    fireEvent.click(await screen.findByRole("button", { name: "Wednesday: 01/07/26" }));

    await waitFor(() => {
      expect(
        within(screen.getByRole("list", { name: "Yesterday bullets" })).getByText("Reviewed PRs"),
      ).toBeInTheDocument();
    });
  });

  it("deletes a whole entry from the history list after confirming", async () => {
    const api = installFakeApi({
      standupEntries: [
        fakeStandupEntry("2026-07-01", {
          bullets: [{ id: 1, section: "today", text: "Old work", sort_order: 1024 }],
        }),
      ],
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);
    await openStandup();
    await screen.findByRole("button", { name: "Wednesday: 01/07/26" });

    fireEvent.click(screen.getByRole("button", { name: "Delete stand-up 2026-07-01" }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Wednesday: 01/07/26" })).not.toBeInTheDocument(),
    );
    expect(api.standupEntries).toHaveLength(0);
  });

  it("keeps the entry when the delete confirmation is declined", async () => {
    const api = installFakeApi({
      standupEntries: [
        fakeStandupEntry("2026-07-01", {
          bullets: [{ id: 1, section: "today", text: "Old work", sort_order: 1024 }],
        }),
      ],
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App />);
    await openStandup();
    await screen.findByRole("button", { name: "Wednesday: 01/07/26" });

    fireEvent.click(screen.getByRole("button", { name: "Delete stand-up 2026-07-01" }));

    expect(screen.getByRole("button", { name: "Wednesday: 01/07/26" })).toBeInTheDocument();
    expect(api.standupEntries).toHaveLength(1);
  });

  it("reorders bullets within a section by drag and drop", async () => {
    const api = installFakeApi();
    render(<App />);
    await openStandup();
    await addBullet("Today", "First");
    await addBullet("Today", "Second");

    const list = screen.getByRole("list", { name: "Today bullets" });
    const firstRow = within(list).getByText("First").closest("li") as HTMLElement;
    const secondRow = within(list).getByText("Second").closest("li") as HTMLElement;
    const dataTransfer = {
      data: new Map<string, string>(),
      setData(format: string, value: string) {
        this.data.set(format, value);
      },
      getData(format: string) {
        return this.data.get(format) ?? "";
      },
    };
    fireEvent.dragStart(secondRow, { dataTransfer });
    fireEvent.drop(firstRow, { dataTransfer });

    await waitFor(() => {
      const texts = within(list)
        .getAllByRole("listitem")
        .map((node) => node.textContent);
      expect(texts).toEqual(["Second", "First"]);
    });
    expect(api.standupEntries[0]?.bullets.map((b) => b.text)).toEqual(["Second", "First"]);
  });

  it("editing the Sprint goal persists it and updates the header", async () => {
    const api = installFakeApi();
    render(<App />);
    await openStandup();

    const goalField = await screen.findByRole("textbox", { name: "Sprint goal" });
    fireEvent.change(goalField, { target: { value: "Ship v1" } });
    fireEvent.blur(goalField);

    await waitFor(() => expect(api.sprintGoal).toBe("Ship v1"));
    expect(screen.getByRole("textbox", { name: "Sprint goal" })).toHaveValue("Ship v1");
  });

  it("opening an old entry shows its snapshotted goal, not the current live goal", async () => {
    installFakeApi({
      sprintGoal: "Ship v2",
      standupEntries: [
        fakeStandupEntry("2026-07-01", {
          sprint_goal_snapshot: "Ship v1",
          bullets: [{ id: 1, section: "today", text: "Old work", sort_order: 1024 }],
        }),
      ],
    });
    render(<App />);
    await openStandup();

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Sprint goal" })).toHaveValue("Ship v2");
    });

    fireEvent.click(await screen.findByRole("button", { name: "Wednesday: 01/07/26" }));

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Sprint goal" })).toHaveValue("Ship v1");
    });
  });

  it("renders Yesterday suggestion chips from suggestion data", async () => {
    installFakeApi({
      standupYesterdaySuggestions: [
        { title: "Ship the release notes" },
        { title: "Fix flaky test" },
      ],
    });
    render(<App />);
    await openStandup();

    const suggestions = await screen.findByRole("list", { name: "Yesterday suggestions" });
    expect(within(suggestions).getByText("Ship the release notes")).toBeInTheDocument();
    expect(within(suggestions).getByText("Fix flaky test")).toBeInTheDocument();
  });

  it("does not render a suggestions row when there are no suggestions", async () => {
    installFakeApi({ standupYesterdaySuggestions: [] });
    render(<App />);
    await openStandup();

    await screen.findByRole("region", { name: "Yesterday" });
    expect(screen.queryByRole("list", { name: "Yesterday suggestions" })).not.toBeInTheDocument();
  });

  it("clicking a suggestion chip appends a bullet to Yesterday without touching other sections", async () => {
    const api = installFakeApi({
      standupYesterdaySuggestions: [{ title: "Ship the release notes" }],
    });
    render(<App />);
    await openStandup();
    await addBullet("Today", "Unrelated today item");
    await addBullet("Blockers", "Unrelated blocker");

    const chip = await screen.findByRole("button", { name: "Ship the release notes" });
    fireEvent.click(chip);

    await waitFor(() => {
      expect(
        within(screen.getByRole("list", { name: "Yesterday bullets" })).getByText(
          "Ship the release notes",
        ),
      ).toBeInTheDocument();
    });
    expect(api.standupEntries[0]?.bullets.map((b) => b.text)).toEqual(
      expect.arrayContaining([
        "Ship the release notes",
        "Unrelated today item",
        "Unrelated blocker",
      ]),
    );
    // The other sections are untouched by the chip click.
    expect(
      within(screen.getByRole("list", { name: "Today bullets" })).getByText("Unrelated today item"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: "Blockers bullets" })).getByText("Unrelated blocker"),
    ).toBeInTheDocument();
    // Once added, the chip is removed so it can't be added again.
    expect(
      screen.queryByRole("button", { name: "Ship the release notes" }),
    ).not.toBeInTheDocument();
  });

  it("merely viewing (and blurring away from) a past entry's snapshot does not overwrite the live goal", async () => {
    const api = installFakeApi({
      sprintGoal: "Ship v2",
      standupEntries: [
        fakeStandupEntry("2026-07-01", {
          sprint_goal_snapshot: "Ship v1",
          bullets: [{ id: 1, section: "today", text: "Old work", sort_order: 1024 }],
        }),
      ],
    });
    render(<App />);
    await openStandup();
    fireEvent.click(await screen.findByRole("button", { name: "Wednesday: 01/07/26" }));
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Sprint goal" })).toHaveValue("Ship v1");
    });

    fireEvent.blur(screen.getByRole("textbox", { name: "Sprint goal" }));

    await waitFor(() => expect(api.sprintGoal).toBe("Ship v2"));
  });

  it("renders Today suggestion chips from Tasks due today, and none for another day", async () => {
    installFakeApi({
      tasks: [
        fakeTask("Ship the release", { due_date: "2026-07-03T00:00:00Z", is_all_day: true }),
        fakeTask("Due tomorrow", { due_date: "2026-07-04T00:00:00Z", is_all_day: true }),
      ],
    });
    render(<App />);
    await openStandup();

    const suggestions = await screen.findByRole("list", { name: "Today suggestions" });
    expect(
      within(suggestions).getByRole("button", { name: "Ship the release" }),
    ).toBeInTheDocument();
    expect(
      within(suggestions).queryByRole("button", { name: "Due tomorrow" }),
    ).not.toBeInTheDocument();
  });

  it("clicking a Today suggestion chip appends a bullet without altering other sections", async () => {
    const api = installFakeApi({
      tasks: [fakeTask("Ship the release", { due_date: "2026-07-03T00:00:00Z", is_all_day: true })],
    });
    render(<App />);
    await openStandup();
    await addBullet("Yesterday", "Reviewed PRs");
    await addBullet("Blockers", "Waiting on design");

    const suggestions = await screen.findByRole("list", { name: "Today suggestions" });
    fireEvent.click(within(suggestions).getByRole("button", { name: "Ship the release" }));

    await waitFor(() => {
      expect(
        within(screen.getByRole("list", { name: "Today bullets" })).getByText("Ship the release"),
      ).toBeInTheDocument();
    });
    expect(
      within(screen.getByRole("list", { name: "Yesterday bullets" })).getByText("Reviewed PRs"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: "Blockers bullets" })).getByText("Waiting on design"),
    ).toBeInTheDocument();
    expect(api.standupEntries[0]?.bullets.map((b) => [b.section, b.text])).toEqual(
      expect.arrayContaining([
        ["yesterday", "Reviewed PRs"],
        ["blockers", "Waiting on design"],
        ["today", "Ship the release"],
      ]),
    );
  });

  it("renders no suggestion chips at all for Blockers", async () => {
    installFakeApi({
      tasks: [fakeTask("Ship the release", { due_date: "2026-07-03T00:00:00Z", is_all_day: true })],
    });
    render(<App />);
    await openStandup();
    await screen.findByRole("list", { name: "Today suggestions" });

    const blockers = screen.getByRole("region", { name: "Blockers" });
    expect(within(blockers).queryByRole("list", { name: /suggestions/i })).not.toBeInTheDocument();
  });
});

describe("Stand-up settings toggle", () => {
  it("shows the Stand-up nav item when the flag is enabled (the default)", async () => {
    installFakeApi();
    render(<App />);

    const nav = await screen.findByRole("navigation", { name: "Views" });
    expect(await within(nav).findByRole("link", { name: "Stand-up" })).toBeInTheDocument();
  });

  it("hides the Stand-up nav item when the flag is disabled", async () => {
    installFakeApi({ standupEnabled: false });
    render(<App />);

    const nav = await screen.findByRole("navigation", { name: "Views" });
    // Wait on a nav item that's always present, so this doesn't race the
    // (still-pending) settings fetch and pass for the wrong reason.
    await within(nav).findByRole("link", { name: "Focus" });
    expect(within(nav).queryByRole("link", { name: "Stand-up" })).not.toBeInTheDocument();
  });
});
