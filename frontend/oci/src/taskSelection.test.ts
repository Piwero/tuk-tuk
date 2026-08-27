import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useTaskSelection } from "./taskSelection";

const ORDER = [1, 2, 3, 4, 5];

describe("useTaskSelection", () => {
  it("toggles a row on and off", () => {
    const { result } = renderHook(() => useTaskSelection());

    act(() => result.current.toggle(2));
    expect(result.current.isSelected(2)).toBe(true);
    expect(result.current.size).toBe(1);

    act(() => result.current.toggle(2));
    expect(result.current.isSelected(2)).toBe(false);
  });

  it("extends a contiguous range from the anchor in visible order", () => {
    const { result } = renderHook(() => useTaskSelection());

    act(() => result.current.toggle(2));
    act(() => result.current.extendTo(4, ORDER));

    expect([...result.current.selected].sort()).toEqual([2, 3, 4]);
  });

  it("extends upward too", () => {
    const { result } = renderHook(() => useTaskSelection());

    act(() => result.current.toggle(4));
    act(() => result.current.extendTo(2, ORDER));

    expect([...result.current.selected].sort()).toEqual([2, 3, 4]);
  });

  it("clears the whole selection and the anchor", () => {
    const { result } = renderHook(() => useTaskSelection());

    act(() => result.current.toggle(2));
    act(() => result.current.clear());
    expect(result.current.size).toBe(0);

    // With the anchor gone, extendTo just adds the one row.
    act(() => result.current.extendTo(4, ORDER));
    expect([...result.current.selected]).toEqual([4]);
  });
});
