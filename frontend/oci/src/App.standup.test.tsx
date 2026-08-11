import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeStandupEntry, installFakeApi } from "./test/fakeApi";

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
  fireEvent.click(within(nav).getByRole("button", { name: "Stand-up" }));
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
    expect(within(history).getByText("Jul 3")).toBeInTheDocument();
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

    fireEvent.click(await screen.findByRole("button", { name: "Jul 1" }));

    await waitFor(() => {
      expect(
        within(screen.getByRole("list", { name: "Yesterday bullets" })).getByText("Reviewed PRs"),
      ).toBeInTheDocument();
    });
  });

  it("deletes a whole entry from the history list", async () => {
    const api = installFakeApi({
      standupEntries: [
        fakeStandupEntry("2026-07-01", {
          bullets: [{ id: 1, section: "today", text: "Old work", sort_order: 1024 }],
        }),
      ],
    });
    render(<App />);
    await openStandup();
    await screen.findByRole("button", { name: "Jul 1" });

    fireEvent.click(screen.getByRole("button", { name: "Delete stand-up 2026-07-01" }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Jul 1" })).not.toBeInTheDocument(),
    );
    expect(api.standupEntries).toHaveLength(0);
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
});
