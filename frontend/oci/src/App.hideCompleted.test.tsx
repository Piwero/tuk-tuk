import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeList, fakeTag, fakeTask, INBOX, installFakeApi } from "./test/fakeApi";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Hide completed", () => {
  it("hides completed tasks from a List view and shows them again on toggle back", async () => {
    installFakeApi({
      tasks: [
        fakeTask("Open task"),
        fakeTask("Done", { completed: true, completed_at: "2026-07-02T10:00:00Z" }),
      ],
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Inbox" }));
    await screen.findByRole("button", { name: "Open details for Open task" });
    expect(screen.getByRole("button", { name: "Open details for Done" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hide completed" }));

    expect(screen.queryByRole("button", { name: "Open details for Done" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open details for Open task" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show completed" }));
    expect(screen.getByRole("button", { name: "Open details for Done" })).toBeInTheDocument();
  });

  it("remembers the choice across a reload", async () => {
    installFakeApi({
      tasks: [fakeTask("Done", { completed: true, completed_at: "2026-07-02T10:00:00Z" })],
    });
    const first = render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Inbox" }));
    fireEvent.click(await screen.findByRole("button", { name: "Hide completed" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Open details for Done" }),
      ).not.toBeInTheDocument(),
    );
    first.unmount();

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Inbox" }));

    expect(await screen.findByRole("button", { name: "Show completed" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open details for Done" })).not.toBeInTheDocument();
  });

  it("also hides completed tasks in a Tag view", async () => {
    const tag = fakeTag("urgent");
    installFakeApi({
      tasks: [
        fakeTask("Open task", { tags: [tag] }),
        fakeTask("Done", { tags: [tag], completed: true, completed_at: "2026-07-02T10:00:00Z" }),
      ],
      tags: [tag],
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "urgent" }));
    await screen.findByRole("button", { name: "Open details for Open task" });

    fireEvent.click(screen.getByRole("button", { name: "Hide completed" }));

    expect(screen.queryByRole("button", { name: "Open details for Done" })).not.toBeInTheDocument();
  });

  it("has no Hide completed toggle on a computed Smart List", async () => {
    const errands = fakeList("Errands");
    installFakeApi({ lists: [INBOX, errands] });
    render(<App />);

    await screen.findByRole("heading", { name: "All" });
    expect(screen.queryByRole("button", { name: "Hide completed" })).not.toBeInTheDocument();
  });

  it("has no Hide completed toggle while in the Completed view", async () => {
    installFakeApi({
      tasks: [fakeTask("Done", { completed: true, completed_at: "2026-07-02T10:00:00Z" })],
    });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Completed" }));

    await screen.findByRole("button", { name: "Open details for Done" });
    expect(screen.queryByRole("button", { name: "Hide completed" })).not.toBeInTheDocument();
  });
});
