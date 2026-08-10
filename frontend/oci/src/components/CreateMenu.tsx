import { useEffect, useRef, useState } from "react";

import { Icon } from "./Icon";

export interface CreateMenuProps {
  onNewList: () => void;
  onNewFolder: () => void;
}

/** The Lists heading's single "+" control: a small menu offering "New list"
 * and, as the quieter second entry, "New folder". A user who has never made
 * a Folder meets the concept here first — never as a permanent, competing
 * button of its own. */
export function CreateMenu({ onNewList, onNewFolder }: CreateMenuProps): JSX.Element {
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

  function choose(action: () => void): void {
    setOpen(false);
    action();
  }

  return (
    <div className="create-menu" ref={root}>
      <button
        type="button"
        className="create-menu-trigger"
        aria-label="Create"
        title="Create"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="plus" size={18} />
      </button>
      {open && (
        <ul role="menu" aria-label="Create" className="create-menu-list">
          <li role="none">
            <button type="button" role="menuitem" onClick={() => choose(onNewList)}>
              New list
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className="create-menu-secondary"
              onClick={() => choose(onNewFolder)}
            >
              New folder
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
