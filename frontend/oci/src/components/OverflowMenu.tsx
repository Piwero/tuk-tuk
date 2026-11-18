import "./OverflowMenu.css";
import { useRef, useState } from "react";

import { Icon, type IconName } from "./Icon";
import { IconButton } from "./IconButton";
import { Popover } from "./Popover";

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
 * where there is no hover, with no long-press to discover. Dismissal (outside
 * pointer-down, Escape) and focus return come from the shared Popover. */
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
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <div className={className ? `overflow-menu ${className}` : "overflow-menu"}>
      <IconButton
        icon="more-vertical"
        size={16}
        className="overflow-menu-trigger"
        label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        buttonRef={trigger}
        onClick={() => setOpen((current) => !current)}
      />
      <Popover open={open} triggerRef={trigger} onClose={() => setOpen(false)}>
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
      </Popover>
    </div>
  );
}
