import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUndoQueue } from "./undoQueue";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useUndoQueue", () => {
  it("holds an entry for the window, then commits it", () => {
    const commit = vi.fn();
    const undo = vi.fn();
    const { result } = renderHook(() => useUndoQueue(5_000));

    act(() => {
      result.current.push("Task deleted", commit, undo);
    });

    expect(result.current.entries).toEqual([{ id: 0, message: "Task deleted" }]);
    expect(commit).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(4_999);
    });
    expect(commit).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(undo).not.toHaveBeenCalled();
    expect(result.current.entries).toEqual([]);
  });

  it("undo cancels the pending commit and never calls it", () => {
    const commit = vi.fn();
    const undo = vi.fn();
    const { result } = renderHook(() => useUndoQueue(5_000));

    let id = -1;
    act(() => {
      id = result.current.push("Completed", commit, undo);
    });

    act(() => {
      result.current.undo(id);
    });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(result.current.entries).toEqual([]);

    // The timer must not still be armed — advancing past the window commits nothing.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it("dismiss ends the window early and commits immediately", () => {
    const commit = vi.fn();
    const undo = vi.fn();
    const { result } = renderHook(() => useUndoQueue(5_000));

    let id = -1;
    act(() => {
      id = result.current.push("Task deleted", commit, undo);
    });

    act(() => {
      result.current.dismiss(id);
    });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(undo).not.toHaveBeenCalled();

    // No orphaned timer left running.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("resolving an unknown id (already resolved) is a no-op", () => {
    const commit = vi.fn();
    const undo = vi.fn();
    const { result } = renderHook(() => useUndoQueue(5_000));

    let id = -1;
    act(() => {
      id = result.current.push("Task deleted", commit, undo);
    });
    act(() => {
      result.current.dismiss(id);
    });
    act(() => {
      // Calling undo after it already committed must not double-fire either callback.
      result.current.undo(id);
    });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(undo).not.toHaveBeenCalled();
  });

  it("tracks multiple independent pending entries", () => {
    const firstCommit = vi.fn();
    const secondCommit = vi.fn();
    const { result } = renderHook(() => useUndoQueue(5_000));

    act(() => {
      result.current.push("Task deleted", firstCommit, vi.fn());
      result.current.push("Completed", secondCommit, vi.fn());
    });
    expect(result.current.entries.map((e) => e.message)).toEqual(["Task deleted", "Completed"]);

    act(() => {
      result.current.undo(0);
    });
    expect(result.current.entries.map((e) => e.message)).toEqual(["Completed"]);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(firstCommit).not.toHaveBeenCalled();
    expect(secondCommit).toHaveBeenCalledTimes(1);
  });
});
