import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeList, fakeTask, installFakeApi } from "./test/fakeApi";

afterEach(() => {
  vi.restoreAllMocks();
});

// #261: a Task row's revealed actions must carry two distinct names, not
// two copies of one — the seam alone (IconButton) can't prove this at the
// unit level since each button is tested in isolation.
describe("A Task row's action glyphs", () => {
  it("each carry a distinct accessible name naming both the action and the Task", async () => {
    const task = fakeTask("Call the plumber", { list_id: 10 });
    installFakeApi({ lists: [fakeList("Errands", { id: 10 })], tasks: [task] });
    render(<App />);

    const row = (await screen.findByText("Call the plumber")).closest("li")!;
    const names = within(row)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"))
      .filter(
        (name): name is string =>
          name !== null &&
          name.includes("Call the plumber") &&
          !name.startsWith("Open details for"),
      );

    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(["Actions for Call the plumber", "Delete Call the plumber"]);
  });
});
