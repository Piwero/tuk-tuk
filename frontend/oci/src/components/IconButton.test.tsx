import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { IconButton } from "./IconButton";

describe("IconButton", () => {
  it("gives the accessible name with no hover at all", () => {
    render(<IconButton icon="trash-2" label="Delete Quarterly report" onClick={() => {}} />);
    expect(screen.getByRole("button", { name: "Delete Quarterly report" })).toBeInTheDocument();
  });

  it("shows the same string as a hint on hover — name and hint can't differ", async () => {
    const user = userEvent.setup();
    render(<IconButton icon="trash-2" label="Delete Quarterly report" onClick={() => {}} />);
    const button = screen.getByRole("button", { name: "Delete Quarterly report" });
    await user.hover(button);
    expect(await screen.findByText("Delete Quarterly report")).toBeInTheDocument();
  });

  it("shows the hint on keyboard focus, not only on hover", async () => {
    render(<IconButton icon="trash-2" label="Delete Quarterly report" onClick={() => {}} />);
    const button = screen.getByRole("button", { name: "Delete Quarterly report" });
    button.focus();
    expect(await screen.findByText("Delete Quarterly report")).toBeInTheDocument();
  });

  it("dismisses on Escape", async () => {
    const user = userEvent.setup();
    render(<IconButton icon="trash-2" label="Delete Quarterly report" onClick={() => {}} />);
    const button = screen.getByRole("button", { name: "Delete Quarterly report" });
    await user.hover(button);
    await screen.findByText("Delete Quarterly report");
    await user.keyboard("{Escape}");
    expect(screen.queryByText("Delete Quarterly report")).not.toBeInTheDocument();
  });

  it("passes through className and click handler", async () => {
    const user = userEvent.setup();
    let clicked = false;
    render(
      <IconButton
        icon="trash-2"
        label="Delete Quarterly report"
        className="row-action-danger"
        onClick={() => {
          clicked = true;
        }}
      />,
    );
    const button = screen.getByRole("button", { name: "Delete Quarterly report" });
    expect(button).toHaveClass("row-action-danger");
    await user.click(button);
    expect(clicked).toBe(true);
  });
});
