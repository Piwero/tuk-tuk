import { useEffect, useRef, useState } from "react";

/** A press-and-hold touch drag, for the drag sources HTML5 drag-and-drop
 * can't serve on a phone: a touch never starts a `dragstart` in most mobile
 * browsers, and where one does, nothing under the finger is a usable drop
 * target. A tap still reaches the source's own click, and a swipe that
 * starts on it still scrolls whatever it sits in; only a press held still
 * for `HOLD_MS` picks the item up.
 *
 * While carried, the page doesn't scroll (the touchmove is cancelled), the
 * caller draws a ghost at `carried.x/y`, and `resolveTarget` maps whatever
 * element sits under the finger to a drop target — or `null`, where a
 * release saves nothing. */

export const HOLD_MS = 350;
/** How far a finger may wander during the hold before it reads as a swipe. */
const SLOP_PX = 8;

export interface Carried<Item, Target> {
  item: Item;
  x: number;
  y: number;
  target: Target | null;
}

export interface TouchDragOptions<Item, Target> {
  resolveTarget: (element: Element | null) => Target | null;
  onPickUp?: (item: Item) => void;
  onDrop: (item: Item, target: Target) => void;
}

export interface TouchDragSourceProps {
  onTouchStart: (event: React.TouchEvent<HTMLElement>) => void;
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
}

export function useTouchDrag<Item, Target>(
  options: TouchDragOptions<Item, Target>,
): {
  carried: Carried<Item, Target> | null;
  sourceProps: (
    item: Item,
    nativeDragStart?: (event: React.DragEvent<HTMLElement>) => void,
  ) => TouchDragSourceProps;
} {
  const [carried, setCarried] = useState<Carried<Item, Target> | null>(null);
  const latest = useRef(options);
  latest.current = options;
  /** Tears down the gesture in progress, if any. */
  const stop = useRef<(() => void) | null>(null);

  useEffect(() => () => stop.current?.(), []);

  function begin(item: Item, startX: number, startY: number): void {
    stop.current?.();
    let picked: Carried<Item, Target> | null = null;

    const timer = window.setTimeout(() => {
      picked = { item, x: startX, y: startY, target: null };
      setCarried(picked);
      latest.current.onPickUp?.(item);
    }, HOLD_MS);

    function onMove(event: TouchEvent): void {
      const touch = event.touches[0];
      if (touch === undefined) {
        return;
      }
      if (picked === null) {
        if (Math.hypot(touch.clientX - startX, touch.clientY - startY) > SLOP_PX) {
          end();
        }
        return;
      }
      event.preventDefault();
      const target = latest.current.resolveTarget(
        document.elementFromPoint(touch.clientX, touch.clientY),
      );
      picked = { item, x: touch.clientX, y: touch.clientY, target };
      setCarried(picked);
    }

    function onEnd(event: TouchEvent): void {
      const dropped = picked;
      end();
      if (dropped === null) {
        return;
      }
      // No click after a drop: the release isn't a tap on the source.
      event.preventDefault();
      const touch = event.changedTouches[0];
      const target =
        touch === undefined
          ? dropped.target
          : latest.current.resolveTarget(document.elementFromPoint(touch.clientX, touch.clientY));
      if (target !== null) {
        latest.current.onDrop(item, target);
      }
    }

    function end(): void {
      window.clearTimeout(timer);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", end);
      stop.current = null;
      picked = null;
      setCarried(null);
    }

    // Non-passive, so a carried item's touchmove can cancel the page scroll
    // (React registers its own touch listeners as passive).
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", end);
    stop.current = end;
  }

  return {
    carried,
    sourceProps: (item, nativeDragStart) => ({
      onTouchStart: (event) => {
        const touch = event.touches[0];
        if (event.touches.length === 1 && touch !== undefined) {
          begin(item, touch.clientX, touch.clientY);
        }
      },
      // A long press would otherwise raise the browser's own context menu
      // (or text selection) over the item it is picking up.
      onContextMenu: (event) => {
        if (stop.current !== null) {
          event.preventDefault();
        }
      },
      // Where a mobile browser would also start its own HTML5 drag from the
      // same long press, the touch drag already owns the gesture; a mouse
      // drag goes on to the source's own HTML5 drag.
      onDragStart: (event) => {
        if (stop.current !== null) {
          event.preventDefault();
          return;
        }
        nativeDragStart?.(event);
      },
    }),
  };
}
