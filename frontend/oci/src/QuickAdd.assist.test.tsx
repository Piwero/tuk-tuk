import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "./App";
import { installFakeApi } from "./test/fakeApi";

describe("Quick-Add Assist affordance (ADR 0005, issue #42)", () => {
  it("stays absent when Assist is unavailable, exactly like today's Quick-Add", async () => {
    installFakeApi({ assistAvailable: false });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    await screen.findByRole("combobox", { name: "Add a task" });

    expect(screen.queryByLabelText("Assist available")).not.toBeInTheDocument();
  });

  it("renders once the availability check reports Assist as available", async () => {
    installFakeApi({ assistAvailable: true });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Inbox" }));

    await screen.findByRole("combobox", { name: "Add a task" });

    expect(await screen.findByLabelText("Assist available")).toBeInTheDocument();
  });
});
