import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeTask, installFakeApi } from "./test/fakeApi";

// Gentle return (issue #548): when the User chooses it, Today collapses every
// earlier overdue Task behind a counted disclosure. Nothing is rescheduled.

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 6, 3, 12));
});
afterEach(() => vi.useRealTimers());

async function openToday(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "Today" }));
  await screen.findByRole("heading", { name: "Today" });
}

function overdue(title: string, day = "2026-07-01") {
  return fakeTask(title, { due_date: `${day}T00:00:00Z`, is_all_day: true });
}

const todayTask = fakeTask("Today thing", { due_date: "2026-07-03T00:00:00Z", is_all_day: true });

describe("Gentle return in Today", () => {
  it("collapses overdue Tasks behind an accurately counted disclosure", async () => {
    installFakeApi({
      tasks: [overdue("Old one"), overdue("Older one", "2026-06-01"), todayTask],
      gentleReturn: true,
    });
    render(<App />);
    await openToday();

    const reveal = await screen.findByRole("button", { name: "Show 2 earlier overdue Tasks" });
    expect(reveal).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("list", { name: "Tasks in Overdue" })).not.toBeInTheDocument();
    expect(screen.queryByText("Old one")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Anytime 1" })).toBeInTheDocument();
  });

  it("counts a large backlog accurately", async () => {
    const backlog = Array.from({ length: 57 }, (_, index) => overdue(`Backlog ${index}`));
    installFakeApi({ tasks: [...backlog, todayTask], gentleReturn: true });
    render(<App />);
    await openToday();

    expect(
      await screen.findByRole("button", { name: "Show 57 earlier overdue Tasks" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Backlog 0")).not.toBeInTheDocument();
  });

  it("uses the singular for one Task", async () => {
    installFakeApi({ tasks: [overdue("Old one")], gentleReturn: true });
    render(<App />);
    await openToday();

    expect(
      await screen.findByRole("button", { name: "Show 1 earlier overdue Task" }),
    ).toBeInTheDocument();
  });

  it("shows no disclosure when nothing is overdue", async () => {
    installFakeApi({ tasks: [todayTask], gentleReturn: true });
    render(<App />);
    await openToday();

    expect(await screen.findByRole("heading", { name: "Anytime 1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /earlier overdue/ })).not.toBeInTheDocument();
  });

  it("reveals the ordinary Overdue group and collapses it again", async () => {
    installFakeApi({ tasks: [overdue("Old one"), overdue("Older one")], gentleReturn: true });
    render(<App />);
    await openToday();

    fireEvent.click(await screen.findByRole("button", { name: "Show 2 earlier overdue Tasks" }));
    expect(screen.getByRole("heading", { name: "Overdue 2" })).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Tasks in Overdue" });
    expect(within(list).getByRole("button", { name: "Open details for Old one" })).toBeVisible();

    const hide = screen.getByRole("button", { name: "Hide 2 earlier overdue Tasks" });
    expect(hide).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(hide);
    expect(screen.queryByRole("list", { name: "Tasks in Overdue" })).not.toBeInTheDocument();
  });

  it("changes no dates when collapsing or revealing", async () => {
    const api = installFakeApi({ tasks: [overdue("Old one")], gentleReturn: true });
    render(<App />);
    await openToday();

    const reveal = await screen.findByRole("button", { name: "Show 1 earlier overdue Task" });
    fireEvent.click(reveal);
    fireEvent.click(screen.getByRole("button", { name: "Hide 1 earlier overdue Task" }));

    expect(api.requests.filter((r) => r.method !== "GET")).toEqual([]);
    expect(api.tasks[0]?.due_date).toBe("2026-07-01T00:00:00Z");
  });

  it("leaves the ordinary Today when the preference is off", async () => {
    installFakeApi({ tasks: [overdue("Old one"), todayTask] });
    render(<App />);
    await openToday();

    expect(await screen.findByRole("heading", { name: "Overdue 1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /earlier overdue/ })).not.toBeInTheDocument();
  });
});

describe("Gentle return setting", () => {
  async function openMyAccount(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
    await user.click(await screen.findByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("menuitem", { name: "My account" }));
    return screen.findByRole("region", { name: "Gentle return" });
  }

  it("is off by default and persists to the server when turned on", async () => {
    const api = installFakeApi({ googleConfigured: false });
    const user = userEvent.setup();
    render(<App />);

    const section = await openMyAccount(user);
    const toggle = within(section).getByLabelText("Gentle return");
    expect(toggle).not.toBeChecked();
    await user.click(toggle);

    await waitFor(() => expect(api.gentleReturn).toBe(true));
  });

  it("turning it off restores the ordinary Today", async () => {
    const api = installFakeApi({
      googleConfigured: false,
      tasks: [overdue("Old one")],
      gentleReturn: true,
    });
    const user = userEvent.setup();
    render(<App />);

    const section = await openMyAccount(user);
    await user.click(within(section).getByLabelText("Gentle return"));
    await waitFor(() => expect(api.gentleReturn).toBe(false));

    await openToday();
    expect(await screen.findByRole("heading", { name: "Overdue 1" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /earlier overdue/ })).not.toBeInTheDocument();
  });
});
