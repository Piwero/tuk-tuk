import "./CreateMenu.css";

import { useRef, useState } from "react";

import { IconButton } from "./IconButton";
import { Popover } from "./Popover";

export interface CreateMenuProps {
  onNewList: () => void;
  onNewFolder: () => void;
}

/** The Lists heading's single "+" control: a small menu offering "New list"
 * and, as the quieter second entry, "New folder". A user who has never made
 * a Folder meets the concept here first — never as a permanent, competing
 * button of its own. Dismissal and focus return come from the shared Popover. */
export function CreateMenu({ onNewList, onNewFolder }: CreateMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  function choose(action: () => void): void {
    setOpen(false);
    action();
  }

  return (
    <div className="create-menu">
      <IconButton
        icon="plus"
        size={18}
        label="Create"
        className="create-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        buttonRef={trigger}
        onClick={() => setOpen((current) => !current)}
      />
      <Popover open={open} triggerRef={trigger} onClose={() => setOpen(false)}>
        <ul role="menu" aria-label="Create" className="create-menu-list">
          <li role="none">
            <button
              className="btn-quiet"
              type="button"
              role="menuitem"
              onClick={() => choose(onNewList)}
            >
              New list
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className="create-menu-secondary btn-quiet"
              onClick={() => choose(onNewFolder)}
            >
              New folder
            </button>
          </li>
        </ul>
      </Popover>
    </div>
  );
}
