import type { KeyboardEvent } from "react";

/** Keyboard movement inside a `role="menu"` list: arrow keys move between
 * entries (wrapping), Home and End jump to the ends. Escape and focus
 * return are the shared Popover's. Shared by the user menu (#473) and the
 * Users row menu (#481). */
export function moveMenuFocus(event: KeyboardEvent<HTMLElement>): void {
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem], [role=menuitemcheckbox]"),
  );
  const index = items.findIndex((item) => item === document.activeElement);
  const target =
    event.key === "ArrowDown"
      ? (index + 1) % items.length
      : event.key === "ArrowUp"
        ? (index - 1 + items.length) % items.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : null;
  if (target === null) return;
  event.preventDefault();
  items[target]?.focus();
}
