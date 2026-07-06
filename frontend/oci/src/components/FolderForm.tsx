import { useState } from "react";

export interface FolderFormProps {
  initialName?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

export function FolderForm({ initialName, onSubmit, onCancel }: FolderFormProps): JSX.Element {
  const [name, setName] = useState(initialName ?? "");

  return (
    <form
      className="list-form"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (trimmed === "") {
          return;
        }
        onSubmit(trimmed);
      }}
    >
      <label>
        Folder name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <button type="submit">Save</button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
