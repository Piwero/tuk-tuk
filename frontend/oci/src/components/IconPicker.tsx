import { Modal } from "./Modal";

export interface PickerIcon {
  name: string;
  emoji: string;
}

export interface IconGroup {
  name: string;
  icons: readonly PickerIcon[];
}

export interface IconPickerProps {
  /** Names the dialog; the caller phrases it for what it is picking. */
  title: string;
  /** The curated emojis on offer, grouped by theme. */
  groups: readonly IconGroup[];
  /** Label of the button that picks "no emoji at all". */
  clearLabel: string;
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

/** Overlay grid of a curated emoji set, grouped by theme. */
export function IconPicker({
  title,
  groups,
  clearLabel,
  onSelect,
  onClose,
}: IconPickerProps): JSX.Element {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="icon-picker">
        <button type="button" className="icon-picker-clear" onClick={() => onSelect("")}>
          {clearLabel}
        </button>
        {groups.map((group) => (
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
