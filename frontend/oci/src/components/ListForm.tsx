import { useState } from "react";

import { type TaskList } from "../api";
import { LIST_ICON_GROUPS } from "../listIcons";
import { DEFAULT_ACCENT } from "../theme";
import { Icon } from "./Icon";
import { IconPicker } from "./IconPicker";

export interface ListFormValues {
  name: string;
  color: string;
  emoji: string;
}

export interface ListFormProps {
  initial?: Pick<TaskList, "name" | "color" | "emoji">;
  onSubmit: (values: ListFormValues) => void;
  onCancel: () => void;
}

export function ListForm({ initial, onSubmit, onCancel }: ListFormProps): JSX.Element {
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? DEFAULT_ACCENT);
  const [emoji, setEmoji] = useState(initial?.emoji ?? "");
  const [pickingEmoji, setPickingEmoji] = useState(false);

  return (
    <form
      className="list-form"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (trimmed === "") {
          return;
        }
        onSubmit({ name: trimmed, color, emoji: emoji.trim() });
      }}
    >
      <label>
        Name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        Color
        <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
      </label>
      {/* The button sits beside the label rather than inside it: a label with
          two controls in it would make the Emoji field ambiguous. */}
      <div className="emoji-field">
        <label>
          Emoji
          <input value={emoji} maxLength={8} onChange={(event) => setEmoji(event.target.value)} />
        </label>
        <button
          type="button"
          className="icon-field"
          aria-label="Choose emoji"
          onClick={() => setPickingEmoji(true)}
        >
          <Icon name="smile" />
        </button>
      </div>
      {pickingEmoji && (
        <IconPicker
          title="Choose an emoji"
          groups={LIST_ICON_GROUPS}
          clearLabel="No emoji"
          onSelect={(picked) => {
            setEmoji(picked);
            setPickingEmoji(false);
          }}
          onClose={() => setPickingEmoji(false)}
        />
      )}
      <button type="submit">Save</button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
