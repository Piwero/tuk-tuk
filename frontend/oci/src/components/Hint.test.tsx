import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { Hint, _resetHintSessionForTests } from "./Hint";

describe("Hint", () => {
  beforeEach(() => {
    _resetHintSessionForTests();
  });

  it("shows the registry copy on hover", async () => {
    const user = userEvent.setup();
    render(
      <Hint hintKey="abandon">
        <button type="button">Abandon</button>
      </Hint>,
    );
    await user.hover(screen.getByText("Abandon"));
    expect(await screen.findByText(/Keeps the Goal in your history/)).toBeInTheDocument();
  });

  it("shows the copy on focus", async () => {
    render(
      <Hint hintKey="abandon">
        <button type="button">Abandon</button>
      </Hint>,
    );
    screen.getByText("Abandon").focus();
    expect(await screen.findByText(/Keeps the Goal in your history/)).toBeInTheDocument();
  });

  it("wires the copy as a description, not the name", async () => {
    const user = userEvent.setup();
    render(
      <Hint hintKey="abandon">
        <button type="button">Abandon</button>
      </Hint>,
    );
    const button = screen.getByRole("button", { name: "Abandon" });
    await user.hover(button);
    await screen.findByText(/Keeps the Goal in your history/);
    const describedBy = button.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy!)?.textContent).toMatch(/Keeps the Goal/);
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(
      <Hint hintKey="abandon">
        <button type="button">Abandon</button>
      </Hint>,
    );
    await user.hover(screen.getByText("Abandon"));
    await screen.findByText(/Keeps the Goal in your history/);
    await user.keyboard("{Escape}");
    expect(screen.queryByText(/Keeps the Goal in your history/)).not.toBeInTheDocument();
  });

  it("does not re-interrupt on a repeated hover within the same session", async () => {
    const user = userEvent.setup();
    render(
      <Hint hintKey="score">
        <button type="button">Score</button>
      </Hint>,
    );
    const button = screen.getByText("Score");
    await user.hover(button);
    await screen.findByText(/mean of its Key Results/);
    await user.unhover(button);
    expect(screen.queryByText(/mean of its Key Results/)).not.toBeInTheDocument();
    await user.hover(button);
    // give the delay time to elapse — should stay suppressed, unlike the first hover
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(screen.queryByText(/mean of its Key Results/)).not.toBeInTheDocument();
  });

  it("keeps re-showing for a destructive control even after being seen", async () => {
    const user = userEvent.setup();
    render(
      <Hint hintKey="list-archive" destructive>
        <button type="button">Archive</button>
      </Hint>,
    );
    const button = screen.getByText("Archive");
    await user.hover(button);
    await screen.findByText(/Hides the List/);
    await user.unhover(button);
    await user.hover(button);
    expect(await screen.findByText(/Hides the List/)).toBeInTheDocument();
  });
});
