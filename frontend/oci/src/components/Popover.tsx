import "./Popover.css";

import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

interface PopoverProps {
  open: boolean;
  triggerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  /** Editable comboboxes keep DOM focus in their input and use aria-activedescendant. */
  focusOnOpen?: boolean;
  /** Viewport point to anchor at instead of the trigger (e.g. a right-click's
   * cursor). The trigger still receives focus back and counts as "inside". */
  anchorPoint?: { x: number; y: number };
}

const focusableSelector =
  "a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";

/** Anchored, non-modal surface. Caller owns trigger semantics and content roles.
 * Mount beside trigger (including inside a Modal) so focus order stays local. */
export function Popover({
  open,
  triggerRef,
  onClose,
  children,
  focusOnOpen = true,
  anchorPoint,
}: PopoverProps): React.JSX.Element | null {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!open || panel.current === null || triggerRef.current === null) return;
    const trigger = triggerRef.current;
    const surface = panel.current;
    function place(): void {
      const anchor =
        anchorPoint === undefined
          ? trigger.getBoundingClientRect()
          : { top: anchorPoint.y, bottom: anchorPoint.y, left: anchorPoint.x };
      const bounds = surface.getBoundingClientRect();
      const gap = 4;
      const below = window.innerHeight - anchor.bottom - gap;
      const above = anchor.top - gap;
      const flip = bounds.height > below && above > below;
      setPosition({
        top: Math.max(gap, flip ? anchor.top - bounds.height - gap : anchor.bottom + gap),
        left: Math.max(gap, Math.min(anchor.left, window.innerWidth - bounds.width - gap)),
      });
    }
    place();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(surface);
    observer?.observe(trigger);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    if (focusOnOpen) {
      (surface.querySelector<HTMLElement>(focusableSelector) ?? surface).focus();
    }
    function outside(event: MouseEvent): void {
      if (
        event.target instanceof Node &&
        !surface.contains(event.target) &&
        !trigger.contains(event.target)
      ) {
        close.current();
      }
    }
    function keydown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      }
    }
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", keydown);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", keydown);
      // Return focus only if it was inside the surface (or lost to body) —
      // an outside click must keep focus where the user put it.
      const active = document.activeElement;
      if (active === null || active === document.body || surface.contains(active)) {
        trigger.focus({ preventScroll: true });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the point is read once per open
  }, [open, triggerRef, focusOnOpen]);

  if (!open) return null;
  return (
    <div className="popover" ref={panel} tabIndex={-1} style={position}>
      {children}
    </div>
  );
}
