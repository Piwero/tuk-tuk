import { useState } from "react";

import { type Tag } from "../api";

export interface TagFormValues {
  name: string;
  color: string;
}

export interface TagFormProps {
  initial?: Pick<Tag, "name" | "color">;
  onSubmit: (values: TagFormValues) => void;
  onCancel: () => void;
}

export function TagForm({ initial, onSubmit, onCancel }: TagFormProps): JSX.Element {
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? "#4772fa");

  return (
    <form
      className="list-form"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (trimmed === "") {
          return;
        }
        onSubmit({ name: trimmed, color });
      }}
    >
      <label>
        Tag name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        Tag color
        <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
      </label>
      <button type="submit">Save</button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
