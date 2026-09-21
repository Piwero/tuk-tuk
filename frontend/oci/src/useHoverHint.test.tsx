import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LONG_PRESS_MS } from "./longPressReveal";
import { useHoverHint } from "./useHoverHint";

function Harness(): JSX.Element {
  const { open, handlers } = useHoverHint();
  return (
    <div>
      <button type="button" {...handlers}>
        Trigger
      </button>
      {open && <span>hint text</span>}
    </div>
  );
}

describe("useHoverHint touch support", () => {
  it("opens on a long-press held for the shared LONG_PRESS_MS duration", () => {
    vi.useFakeTimers();
    render(<Harness />);
    const button = screen.getByText("Trigger");
    fireEvent.touchStart(button);
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(screen.getByText("hint text")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("does not open on a normal short tap", () => {
    vi.useFakeTimers();
    render(<Harness />);
    const button = screen.getByText("Trigger");
    fireEvent.touchStart(button);
    fireEvent.touchEnd(button);
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(screen.queryByText("hint text")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("closes on a subsequent tap elsewhere", () => {
    vi.useFakeTimers();
    render(<Harness />);
    const button = screen.getByText("Trigger");
    fireEvent.touchStart(button);
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(screen.getByText("hint text")).toBeInTheDocument();
    fireEvent.touchStart(document.body);
    expect(screen.queryByText("hint text")).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});
