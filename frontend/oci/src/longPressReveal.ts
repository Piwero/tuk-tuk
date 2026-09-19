import { useRef, useState } from "react";

/** How long a touch has to hold still before row actions reveal (#168).
 * Long enough that a scroll or a normal tap never trips it, short enough
 * not to feel unresponsive. Owned here so every row-like surface that
 * adopts the long-press gesture shares one duration (issue #245). */
export const LONG_PRESS_MS = 500;

/** The reveal state and the five touch handlers that drive it, ready to
 * spread onto any row-like surface (a Task row, a Goal card, ...).
 *
 * The behaviour, unchanged from the Task row gesture it was extracted from
 * (#168): at rest the actions sit closed (`data-actions-open` absent). A
 * touch that holds still for `LONG_PRESS_MS` opens them (`data-actions-open`
 * set) and swallows the trailing synthetic click so revealing the actions
 * does not also trigger the host's own click — opening a Task or toggling a
 * checkbox. A touch that moves or is cancelled clears the timer, so a scroll
 * or drag never opens them. A subsequent click anywhere on the host closes
 * them again. */
export interface LongPressReveal {
  /** `true` when open, `undefined` when not — the DOM attribute contract a
   * CSS rule reads (`[data-actions-open]`) and the Task row already emits. */
  dataActionsOpen: true | undefined;
  onTouchStart: () => void;
  onTouchEnd: (event: React.TouchEvent) => void;
  onTouchMove: () => void;
  onTouchCancel: () => void;
  onClick: () => void;
}

export function useLongPressReveal(): LongPressReveal {
  const [actionsOpen, setActionsOpen] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  function clearPressTimer(): void {
    if (pressTimer.current !== null) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  function handleTouchStart(): void {
    longPressed.current = false;
    clearPressTimer();
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      setActionsOpen(true);
    }, LONG_PRESS_MS);
  }

  function handleTouchEnd(event: React.TouchEvent): void {
    clearPressTimer();
    if (longPressed.current) {
      // Swallow the trailing synthetic click so revealing the actions
      // doesn't also open the host or toggle its checkbox.
      event.preventDefault();
    }
  }

  return {
    dataActionsOpen: actionsOpen || undefined,
    onTouchStart: handleTouchStart,
    onTouchEnd: handleTouchEnd,
    onTouchMove: clearPressTimer,
    onTouchCancel: clearPressTimer,
    onClick: () => setActionsOpen(false),
  };
}
