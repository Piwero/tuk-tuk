import "./OverflowMenu.css";
import { useEffect, useRef, useState } from "react";

import { Icon, type IconName } from "./Icon";
import { IconButton } from "./IconButton";

export interface OverflowMenuItem {
  /** Visible text. */
  text: string;
  /** Accessible name, when the text alone is ambiguous on the page. */
  label?: string;
  icon: IconName;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/** A kebab trigger that opens a short menu of actions. The trigger and every
 * item are real <button>s, so it works by keyboard and under a coarse pointer
 * where there is no hover, with no long-press to discover. Dismisses on an
 * outside pointer-down and on Escape, like HabitActionsMenu. */
export function OverflowMenu({
  label,
  items,
  className,
}: {
  label: string;
  items: OverflowMenuItem[];
  className?: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: MouseEvent): void {
      if (root.current !== null && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={className ? `overflow-menu ${className}` : "overflow-menu"} ref={root}>
      <IconButton
        icon="more-vertical"
        size={16}
        className="overflow-menu-trigger"
        label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      />
      {open && (
        <ul role="menu" aria-label={label} className="overflow-menu-list">
          {items.map((item) => (
            <li role="none" key={item.text}>
              <button
                type="button"
                role="menuitem"
                className={item.danger ? "overflow-menu-danger btn-quiet" : "btn-quiet"}
                aria-label={item.label}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                <Icon name={item.icon} size={16} />
                {item.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
