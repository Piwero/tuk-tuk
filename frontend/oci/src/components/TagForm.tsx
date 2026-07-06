import { useState } from "react";

import { ApiError, type Tag } from "../api";
import { DEFAULT_ACCENT } from "../theme";

export interface TagFormValues {
  name: string;
  color: string;
}

export interface TagFormProps {
  initial?: Pick<Tag, "name" | "color">;
  /** Rejections (e.g. duplicate names) are shown to the user, keeping the form open. */
  onSubmit: (values: TagFormValues) => Promise<void>;
  onCancel: () => void;
}

export function TagForm({ initial, onSubmit, onCancel }: TagFormProps): JSX.Element {
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? DEFAULT_ACCENT);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    const trimmed = name.trim();
    if (trimmed === "") {
      return;
    }
    try {
      await onSubmit({ name: trimmed, color });
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "Something went wrong");
    }
  }

  return (
    <form
      className="list-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
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
      {error !== null && <p role="alert">{error}</p>}
      <button type="submit">Save</button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
