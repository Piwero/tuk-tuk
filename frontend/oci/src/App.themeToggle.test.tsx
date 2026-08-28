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
});

describe("Dark mode toggle in the nav bar", () => {
  it("flips the resolved theme and persists the choice", async () => {
    installFakeApi({ lists: [INBOX] });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "All" });

    const sidebar = screen.getByRole("complementary");
    const toggle = within(sidebar).getByRole("button", { name: "Switch to dark mode" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    await user.click(toggle);

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("tuktuk.theme")).toBe("dark");
    expect(within(sidebar).getByRole("button", { name: "Switch to light mode" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(within(sidebar).getByRole("button", { name: "Switch to light mode" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("tuktuk.theme")).toBe("light");
  });

  it("stays in sync with the Settings › Appearance radio group", async () => {
    installFakeApi({ lists: [INBOX] });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "All" });

    await user.click(screen.getByRole("link", { name: "Settings" }));
    await user.click(screen.getByRole("radio", { name: "Dark" }));

    const sidebar = screen.getByRole("complementary");
    expect(
      within(sidebar).getByRole("button", { name: "Switch to light mode" }),
    ).toBeInTheDocument();
  });
});
