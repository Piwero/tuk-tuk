import { useState } from "react";

import { type Folder, type TaskList } from "../api";
import { LIST_ICON_GROUPS } from "../listIcons";
import { byOrder } from "../ordering";
import { DEFAULT_ACCENT } from "../theme";
import { Icon } from "./Icon";
import { IconPicker } from "./IconPicker";

export interface ListFormValues {
  name: string;
  color: string;
  emoji: string;
  /** null files the List at the top level. Present in the submitted values
   * only when the Folder field was offered (see `folders` below) — a form
   * with zero Folders never touches this piece of a List. */
  folderId: number | null;
}

export interface ListFormProps {
  initial?: Pick<TaskList, "name" | "color" | "emoji">;
  /** Every Folder in the workspace. The Folder field only appears when this
   * is non-empty — progressive disclosure: a user with no Folders yet has
   * nothing to file into. */
  folders?: Folder[];
  /** The Folder to preselect: the List's current Folder when editing, or
   * the Folder a "New list" action was started from when creating. */
  initialFolderId?: number | null;
  onSubmit: (values: ListFormValues) => void;
  onCancel: () => void;
}

export function ListForm({
  initial,
  folders = [],
  initialFolderId = null,
  onSubmit,
  onCancel,
}: ListFormProps): JSX.Element {
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? DEFAULT_ACCENT);
  const [emoji, setEmoji] = useState(initial?.emoji ?? "");
  const [pickingEmoji, setPickingEmoji] = useState(false);
  const [folderId, setFolderId] = useState<number | null>(initialFolderId);

  return (
    <form
      className="list-form"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (trimmed === "") {
          return;
        }
        onSubmit({ name: trimmed, color, emoji: emoji.trim(), folderId });
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
      {folders.length > 0 && (
        <label>
          Folder
          <select
            value={folderId === null ? "" : String(folderId)}
            onChange={(event) =>
              setFolderId(event.target.value === "" ? null : Number(event.target.value))
            }
          >
            <option value="">No folder</option>
            {[...folders].sort(byOrder).map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </label>
      )}
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
