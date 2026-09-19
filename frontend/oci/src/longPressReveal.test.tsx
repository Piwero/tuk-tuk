import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LONG_PRESS_MS, useLongPressReveal } from "./longPressReveal";

/** Renders a host element wired up with the hook's handlers and the
 * `data-actions-open` contract, so the gesture is asserted the same way any
 * row-like surface would adopt it — not against the hook's internal state. */
function harness(): { host: HTMLElement } {
  function Host() {
    const reveal = useLongPressReveal();
    return (
      <div
        data-testid="host"
        data-actions-open={reveal.dataActionsOpen}
        onTouchStart={reveal.onTouchStart}
        onTouchEnd={reveal.onTouchEnd}
        onTouchMove={reveal.onTouchMove}
        onTouchCancel={reveal.onTouchCancel}
        onClick={reveal.onClick}
      />
    );
  }
  render(<Host />);
  return { host: screen.getByTestId("host") };
}

describe("useLongPressReveal", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("defines the long-press window once, in the shared piece", () => {
    expect(LONG_PRESS_MS).toBe(500);
  });

  it("is closed at rest", () => {
    const { host } = harness();
    expect(host).not.toHaveAttribute("data-actions-open");
  });

  it("opens after holding a touch for the long-press window", () => {
    const { host } = harness();

    fireEvent.touchStart(host);
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });

    expect(host).toHaveAttribute("data-actions-open", "true");
  });

  it("does not open on a plain, short tap", () => {
    const { host } = harness();

    fireEvent.touchStart(host);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.touchEnd(host);
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });

    expect(host).not.toHaveAttribute("data-actions-open");
  });

  it("cancels the long-press on a touch move (a scroll or drag)", () => {
    const { host } = harness();

    fireEvent.touchStart(host);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.touchMove(host);
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });

    expect(host).not.toHaveAttribute("data-actions-open");
  });

  it("cancels the long-press on a touch cancel", () => {
    const { host } = harness();

    fireEvent.touchStart(host);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.touchCancel(host);
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });

    expect(host).not.toHaveAttribute("data-actions-open");
  });

  it("swallows the trailing synthetic click after a long-press", () => {
    const { host } = harness();

    fireEvent.touchStart(host);
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });

    const clickFired = fireEvent.touchEnd(host);
    expect(clickFired).toBe(false);
  });

  it("closes again once something in the host is tapped", () => {
    const { host } = harness();

    fireEvent.touchStart(host);
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(host).toHaveAttribute("data-actions-open", "true");

    fireEvent.click(host);

    expect(host).not.toHaveAttribute("data-actions-open");
  });
});
