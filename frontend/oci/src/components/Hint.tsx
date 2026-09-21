import { cloneElement, isValidElement, useId, useRef } from "react";

import { HINT_REGISTRY, type HintKey } from "../hintRegistry";

export type { HintKey };
import { useHoverHint } from "../useHoverHint";

// Session-scoped: a hint that's been read once fades for the rest of the
// visit (#261) — not persisted, cleared on reload. Destructive controls are
// exempt (see `destructive` below): the cost of a wrong guess there is lost
// data, not confusion, so they keep explaining themselves regardless.
const shownThisSession = new Set<HintKey>();

/** Test-only: clears session suppression between test cases. Not exported
 * from any production entry point. */
export function _resetHintSessionForTests(): void {
  shownThisSession.clear();
}

interface HintProps {
  hintKey: HintKey;
  /** Delete/Archive-grade controls: the hint keeps showing every time even
   * after being read once, because the cost of a wrong guess is data loss,
   * not confusion (#261). */
  destructive?: boolean;
  children: React.ReactElement;
}

/** Explanatory copy for a domain term, sourced from a single registry keyed
 * by term (#261) — Key Result explained here and on a Goal card can't read
 * two different ways. Wraps its child with a hover/focus-triggered popover
 * wired as an accessible *description* (`aria-describedby`), never a name,
 * so the child's own accessible name is untouched. */
export function Hint({ hintKey, destructive = false, children }: HintProps): JSX.Element {
  const { open, handlers } = useHoverHint();
  const id = useId();
  // A non-destructive hint suppresses itself once it has been shown for
  // this term anywhere this session (`shownThisSession`) — help fades as
  // the user learns. Destructive controls opt out: the cost of a wrong
  // guess there is lost data, not confusion, so they keep explaining
  // themselves every time.
  const seenBeforeThisOpen = useRef(shownThisSession.has(hintKey));
  const copy = HINT_REGISTRY[hintKey];

  const visible = open && (destructive || !seenBeforeThisOpen.current);

  if (open) {
    shownThisSession.add(hintKey);
  }
  if (!open) {
    seenBeforeThisOpen.current = shownThisSession.has(hintKey);
  }

  if (!isValidElement(children)) {
    return children;
  }

  const child = cloneElement(children, {
    "aria-describedby": visible ? id : undefined,
    onMouseEnter: handlers.onMouseEnter,
    onMouseLeave: handlers.onMouseLeave,
    onFocus: handlers.onFocus,
    onBlur: handlers.onBlur,
    onKeyDown: handlers.onKeyDown,
    onTouchStart: handlers.onTouchStart,
    onTouchEnd: handlers.onTouchEnd,
    onTouchMove: handlers.onTouchMove,
    onTouchCancel: handlers.onTouchCancel,
  } as React.HTMLAttributes<HTMLElement>);

  return (
    <span className="hint-wrap">
      {child}
      {visible && (
        <span role="tooltip" id={id} className="hint-popover">
          {copy}
        </span>
      )}
    </span>
  );
}
