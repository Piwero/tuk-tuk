import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { INBOX, installFakeApi } from "./test/fakeApi";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.removeAttribute("data-theme");
  window.history.replaceState(null, "", "/");
});

async function openAccountMenu(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(await screen.findByRole("button", { name: "Account menu" }));
  return screen.getByRole("menu", { name: "Account menu" });
}

describe("Dark mode switch in the user menu (#473)", () => {
  it("flips the resolved theme and persists the choice", async () => {
    installFakeApi({ lists: [INBOX] });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "All" });

    const menu = await openAccountMenu(user);
    const toggle = within(menu).getByRole("menuitemcheckbox", { name: "Dark mode" });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    await user.click(toggle);

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("tuktuk.theme")).toBe("dark");
    expect(within(menu).getByRole("menuitemcheckbox", { name: "Dark mode" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await user.click(within(menu).getByRole("menuitemcheckbox", { name: "Dark mode" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("tuktuk.theme")).toBe("light");
  });

  it("stays in sync with the Settings › Appearance radio group", async () => {
    installFakeApi({ lists: [INBOX] });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "All" });

    await user.click(
      within(await openAccountMenu(user)).getByRole("menuitem", { name: "My account" }),
    );
    await user.click(await screen.findByRole("radio", { name: "Dark" }));

    const menu = await openAccountMenu(user);
    expect(within(menu).getByRole("menuitemcheckbox", { name: "Dark mode" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});
