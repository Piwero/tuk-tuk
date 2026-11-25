import "./HabitActionsMenu.css";
import { useRef, useState } from "react";

import { type Habit } from "../api";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { Popover } from "./Popover";

export interface HabitActionsMenuProps {
  habit: Habit;
  onHistory: () => void;
  onEdit: () => void;
  /** Starts a pause (issue #559); null where a pause is already current or
   * planned (its own Edit pause is on the card) or the Habit is archived. */
  onPause?: (() => void) | null;
  onToggleArchive: () => void;
  onDelete: () => void;
}

/** A Habit card's single actions menu: History, Edit, Pause, Archive/Unarchive
 * and Delete fold behind one kebab trigger rather than four permanent buttons.
 * The trigger and every item are real <button>s, so the whole menu is
 * reachable by keyboard and under a coarse pointer where there is no hover.
 * Dismissal and focus return come from the shared Popover. */
export function HabitActionsMenu({
  habit,
  onHistory,
  onEdit,
  onPause = null,
  onToggleArchive,
  onDelete,
}: HabitActionsMenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  function choose(action: () => void): void {
    setOpen(false);
    action();
  }

  return (
    <div className="habit-actions-menu">
      <IconButton
        icon="more-vertical"
        size={16}
        className="habit-actions-trigger"
        label={`Actions for ${habit.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        buttonRef={trigger}
        onClick={() => setOpen((current) => !current)}
      />
      <Popover open={open} triggerRef={trigger} onClose={() => setOpen(false)}>
        <ul role="menu" aria-label={`Actions for ${habit.name}`} className="habit-actions-list">
          <li role="none">
            <button
              className="btn-quiet"
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
              className="btn-quiet"
              type="button"
              role="menuitem"
              aria-label={`Edit ${habit.name}`}
              onClick={() => choose(onEdit)}
            >
              <Icon name="pencil" size={16} />
              Edit
            </button>
          </li>
          {onPause !== null && (
            <li role="none">
              <button
                className="btn-quiet"
                type="button"
                role="menuitem"
                aria-label={`Pause ${habit.name}`}
                onClick={() => choose(onPause)}
              >
                <Icon name="pause" size={16} />
                Pause
              </button>
            </li>
          )}
          <li role="none">
            <button
              className="btn-quiet"
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
              className="habit-actions-danger btn-quiet"
              aria-label={`Delete habit ${habit.name}`}
              onClick={() => choose(onDelete)}
            >
              <Icon name="x" size={16} />
              Delete
            </button>
          </li>
        </ul>
      </Popover>
    </div>
  );
}
