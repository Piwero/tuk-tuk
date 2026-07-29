import { HABIT_ICON_GROUPS } from "../habitIcons";
import { Modal } from "./Modal";

export interface IconPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

/** Overlay grid of the curated Habit emojis, grouped by theme. */
export function IconPicker({ onSelect, onClose }: IconPickerProps): JSX.Element {
  return (
    <Modal title="Choose an icon" onClose={onClose}>
      <div className="icon-picker">
        <button type="button" className="icon-picker-clear" onClick={() => onSelect("")}>
          No icon
        </button>
        {HABIT_ICON_GROUPS.map((group) => (
          <section key={group.name}>
            <h3>{group.name}</h3>
            <div className="icon-picker-grid">
              {group.icons.map((icon) => (
                <button
                  key={icon.emoji}
                  type="button"
                  aria-label={icon.name}
                  onClick={() => onSelect(icon.emoji)}
                >
                  {icon.emoji}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  );
}
