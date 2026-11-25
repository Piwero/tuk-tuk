import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { installFakeApi } from "./test/fakeApi";

// Quick-Add save feedback (#544): saving, duplicate prevention, inline
// validation, failed-save retry and the success announcement.

afterEach(() => {
  vi.restoreAllMocks();
});

const isTaskCreate = (method: string, pathname: string): boolean =>
  method === "POST" && pathname === "/api/v1/tasks";

async function openQuickAdd(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(await screen.findByRole("link", { name: "Inbox" }));
  await user.click(screen.getByRole("button", { name: "Quick add" }));
  return screen.findByRole("dialog", { name: "Quick add" });
}

function taskCreates(api: ReturnType<typeof installFakeApi>): number {
  return api.requests.filter((r) => r.method === "POST" && r.url === "/api/v1/tasks").length;
}

describe("Quick add dialog save feedback", () => {
  it("says Saving while the Task is created and creates it once however often it is activated", async () => {
    const api = installFakeApi();
    let release!: () => void;
    api.writeGate = {
      match: isTaskCreate,
      gate: new Promise<void>((resolve) => {
        release = resolve;
      }),
    };
    const user = userEvent.setup();
    render(<App />);
    const dialog = await openQuickAdd(user);

    await user.type(within(dialog).getByLabelText("Title"), "Buy oat milk");
    await user.click(within(dialog).getByRole("button", { name: "Add task" }));

    const saving = await within(dialog).findByRole("button", { name: "Saving…" });
    expect(saving).toHaveAttribute("aria-disabled", "true");
    expect(saving).toHaveFocus();
    await user.click(saving);
    await user.type(within(dialog).getByLabelText("Title"), "{Enter}");

    release();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(taskCreates(api)).toBe(1);
    expect(api.tasks.filter((task) => task.title === "Buy oat milk")).toHaveLength(1);
  });

  it("explains a title with no words beside the Title field, keeps what was typed, and clears once fixed", async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    const dialog = await openQuickAdd(user);
    const title = within(dialog).getByLabelText("Title");

    await user.type(title, "  #errands");
    await user.click(within(dialog).getByRole("button", { name: "Add task" }));

    const message = await within(dialog).findByRole("alert");
    expect(message).toHaveTextContent("Enter a title to add the Task");
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(title).toHaveAccessibleDescription("Enter a title to add the Task");
    expect(title).toHaveValue("  #errands");
    expect(taskCreates(api)).toBe(0);

    await user.type(title, " Buy oat milk");
    expect(title).not.toHaveAttribute("aria-invalid");
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says Task not saved when the create fails, keeps the input editable, and Retry saves the same Task", async () => {
    const api = installFakeApi();
    api.failWrite = isTaskCreate;
    const user = userEvent.setup();
    render(<App />);
    const dialog = await openQuickAdd(user);
    const title = within(dialog).getByLabelText("Title");

    await user.type(title, "Buy oat milk !high #errands");
    await user.click(within(dialog).getByRole("button", { name: "Add task" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Task not saved");
    expect(within(dialog).getByRole("button", { name: "Add task" })).not.toHaveAttribute(
      "aria-disabled",
    );
    expect(title).toHaveValue("Buy oat milk !high #errands");
    expect(title).toBeEnabled();
    expect(api.tasks.filter((task) => task.title === "Buy oat milk")).toHaveLength(0);
    // Never pretend success: no confirmation was raised for the failed save.
    expect(screen.queryByText(/Added to|Task saved/)).not.toBeInTheDocument();

    api.failWrite = null;
    await user.click(within(dialog).getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const saved = api.tasks.filter((task) => task.title === "Buy oat milk");
    expect(saved).toHaveLength(1);
    expect(saved[0]?.priority).toBe("high");
    expect(saved[0]?.tags.map((tag) => tag.name)).toEqual(["errands"]);
    // The Tag the first attempt created is reused, not created again.
    expect(
      api.requests.filter((r) => r.method === "POST" && r.url === "/api/v1/tags"),
    ).toHaveLength(1);
    expect(taskCreates(api)).toBe(2);
  });

  it("announces a saved Task through a live region that was already on the page", async () => {
    installFakeApi();
    const user = userEvent.setup();
    render(<App />);
    const dialog = await openQuickAdd(user);
    // A live region inserted together with its text is announced unreliably,
    // so the confirmation must land in one mounted before the save.
    const regions = [...document.querySelectorAll('[aria-live="polite"]')];

    await user.type(within(dialog).getByLabelText("Title"), "Buy oat milk{Enter}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const announcement = await screen.findByText("Task saved to Inbox");
    const region = announcement.closest('[aria-live="polite"]');
    expect(region).not.toBeNull();
    expect(regions).toContain(region);
  });
});
