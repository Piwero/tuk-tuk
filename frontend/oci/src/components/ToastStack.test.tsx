import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ToastStack } from "./ToastStack";

describe("ToastStack", () => {
  it("renders nothing when there are no pending entries", () => {
    const { container } = render(<ToastStack entries={[]} onUndo={vi.fn()} onDismiss={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("announces each entry as a live status region with an Undo affordance", () => {
    render(
      <ToastStack
        entries={[{ id: 1, message: "Task deleted", undoable: true }]}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    const toast = screen.getByRole("status");
    expect(toast).toHaveAttribute("aria-live", "polite");
    expect(toast).toHaveTextContent("Task deleted");
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("Undo is reachable by keyboard and reports the entry's id", async () => {
    const onUndo = vi.fn();
    const user = userEvent.setup();
    render(
      <ToastStack
        entries={[{ id: 7, message: "Completed", undoable: true }]}
        onUndo={onUndo}
        onDismiss={vi.fn()}
      />,
    );

    await user.tab();
    expect(screen.getByRole("button", { name: "Undo" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onUndo).toHaveBeenCalledWith(7);
  });

  it("Dismiss reports the entry's id", async () => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(
      <ToastStack
        entries={[{ id: 3, message: "Task deleted", undoable: true }]}
        onUndo={vi.fn()}
        onDismiss={onDismiss}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledWith(3);
  });

  it("stacks multiple pending toasts independently", () => {
    render(
      <ToastStack
        entries={[
          { id: 1, message: "Task deleted", undoable: true },
          { id: 2, message: "Completed", undoable: true },
        ]}
        onUndo={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("status")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Undo" })).toHaveLength(2);
  });
});
