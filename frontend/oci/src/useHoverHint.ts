import { useEffect, useRef, useState } from "react";

import { LONG_PRESS_MS } from "./longPressReveal";

/** Short delay before a hint appears — long enough that sweeping a pointer
 * across a toolbar doesn't strobe a hint per control (#261). */
const HINT_DELAY_MS = 400;

/** Shared open/close plumbing for a hover- and focus-triggered hint popover
 * (#261) — used by both `IconButton` and `Hint`, which stay separate
 * components with separate ARIA contracts but the same show/hide behaviour:
 * opens after a short delay, closes on pointer-out, blur, Escape, or scroll.
 *
 * Touch has no `onMouseEnter`, so it reuses the app's existing long-press
 * reveal gesture and shared `LONG_PRESS_MS` duration (#245) instead of a
 * second timing: holding the trigger for `LONG_PRESS_MS` opens the hint,
 * a subsequent tap anywhere closes it. */
export function useHoverHint(): {
  open: boolean;
  handlers: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onFocus: () => void;
    onBlur: () => void;
    onKeyDown: (event: React.KeyboardEvent) => void;
    onTouchStart: () => void;
    onTouchEnd: () => void;
    onTouchMove: () => void;
    onTouchCancel: () => void;
  };
} {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  function clearTimer(): void {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }

  function clearPressTimer(): void {
    if (pressTimer.current !== null) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
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

  function handleTouchStart(): void {
    longPressed.current = false;
    clearPressTimer();
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      setOpen(true);
    }, LONG_PRESS_MS);
  }

  function handleTouchEnd(): void {
    clearPressTimer();
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
    function onTouchStartElsewhere(): void {
      if (longPressed.current) {
        close();
      }
    }
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("touchstart", onTouchStartElsewhere, true);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("touchstart", onTouchStartElsewhere, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close is stable across renders (no captured props/state)
  }, [open]);

  useEffect(
    () => () => {
      clearTimer();
      clearPressTimer();
    },
    [],
  );

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
      onTouchStart: handleTouchStart,
      onTouchEnd: handleTouchEnd,
      onTouchMove: clearPressTimer,
      onTouchCancel: clearPressTimer,
    },
  };
}
