import { useEffect, useRef, useState } from "react";

import { type Habit } from "../api";
import { Icon } from "./Icon";

export interface HabitActionsMenuProps {
  habit: Habit;
  onHistory: () => void;
  onEdit: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
}

/** A Habit card's single actions menu: History, Edit, Archive/Unarchive and
 * Delete fold behind one kebab trigger rather than four permanent buttons.
 * The trigger and every item are real <button>s, so the whole menu is
 * reachable by keyboard and under a coarse pointer where there is no hover.
 * Mirrors CreateMenu's dismiss handling (outside pointer-down, Escape). */
export function HabitActionsMenu({
  habit,
  onHistory,
  onEdit,
  onToggleArchive,
  onDelete,
}: HabitActionsMenuProps): JSX.Element {
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
    <div className="habit-actions-menu" ref={root}>
      <button
        type="button"
        className="habit-actions-trigger"
        aria-label={`Actions for ${habit.name}`}
        title="Actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="more-vertical" size={16} />
      </button>
      {open && (
        <ul role="menu" aria-label={`Actions for ${habit.name}`} className="habit-actions-list">
          <li role="none">
            <button
              type="button"
              role="menuitem"
              aria-label={`History ${habit.name}`}
              onClick={() => choose(onHistory)}
            >
              <Icon name="chart-column" size={16} />
              History
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              aria-label={`Edit ${habit.name}`}
              onClick={() => choose(onEdit)}
            >
              <Icon name="pencil" size={16} />
              Edit
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              aria-label={habit.is_archived ? `Unarchive ${habit.name}` : `Archive ${habit.name}`}
              onClick={() => choose(onToggleArchive)}
            >
              <Icon name={habit.is_archived ? "archive-restore" : "archive"} size={16} />
              {habit.is_archived ? "Unarchive" : "Archive"}
            </button>
          </li>
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className="habit-actions-danger"
              aria-label={`Delete habit ${habit.name}`}
              onClick={() => choose(onDelete)}
            >
              <Icon name="x" size={16} />
              Delete
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
