import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { installFakeApi } from "./test/fakeApi";

// Note: fetch stays stubbed across tests (each test installs a fresh fake).
afterEach(() => {
  vi.restoreAllMocks();
});

describe("Quick-Add prose date hint (issue #259)", () => {
  it("flags a prose capture whose text reads like a date, with a one-click way to add one", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "dentist tuesday 3pm remind me the day before{Enter}");

    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent("no date set");
    expect(toast).toHaveTextContent("Add date");
  });

  it("opens the Task's detail from the hint, without retyping the title", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "call the dentist tomorrow{Enter}");
    await user.click(await screen.findByRole("button", { name: "Add date" }));

    expect(await screen.findByDisplayValue("call the dentist tomorrow")).toBeInTheDocument();
  });

  it("stays a single uninterrupted action for a fully-tokenised line — no date hint fires", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "buy milk #errand{Enter}");

    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent("Added to Inbox");
    expect(toast).not.toHaveTextContent("no date set");
  });

  it("does not flag ordinary prose with no date-shaped words", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "buy milk{Enter}");

    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent("Added to Inbox");
  });

  it("does not flag a capture whose @ token already resolved a date", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-01T12:00:00Z"));
    installFakeApi();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    const input = await screen.findByRole("combobox", { name: "Add a task" });
    await user.type(input, "dentist @tomorrow{Enter}");

    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent("Added to Inbox");
    expect(toast).not.toHaveTextContent("no date set");
    vi.useRealTimers();
  });
});
