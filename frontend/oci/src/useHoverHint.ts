import { useEffect, useRef, useState } from "react";

/** Short delay before a hint appears — long enough that sweeping a pointer
 * across a toolbar doesn't strobe a hint per control (#261). */
const HINT_DELAY_MS = 400;

/** Shared open/close plumbing for a hover- and focus-triggered hint popover
 * (#261) — used by both `IconButton` and `Hint`, which stay separate
 * components with separate ARIA contracts but the same show/hide behaviour:
 * opens after a short delay, closes on pointer-out, blur, Escape, or scroll.
 *
 * ponytail: touch has no `onMouseEnter`, so a hint never opens on a touch
 * device yet — the spec calls for reusing `useLongPressReveal` there.
 * Add a touch path (long-press → open, tap-elsewhere → close) when touch
 * coverage for #261 is picked up. */
export function useHoverHint(): {
  open: boolean;
  handlers: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onFocus: () => void;
    onBlur: () => void;
    onKeyDown: (event: React.KeyboardEvent) => void;
  };
} {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimer(): void {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }

  function scheduleOpen(): void {
    clearTimer();
    timer.current = setTimeout(() => setOpen(true), HINT_DELAY_MS);
  }

  function close(): void {
    clearTimer();
    setOpen(false);
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    function onScroll(): void {
      close();
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        close();
      }
    }
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close is stable across renders (no captured props/state)
  }, [open]);

  useEffect(() => clearTimer, []);

  return {
    open,
    handlers: {
      onMouseEnter: scheduleOpen,
      onMouseLeave: close,
      onFocus: scheduleOpen,
      onBlur: close,
      onKeyDown: (event: React.KeyboardEvent) => {
        if (event.key === "Escape") {
          close();
        }
      },
    },
  };
}
