import { useState } from "react";

export interface SectionNameFormProps {
  initialName?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

export function SectionNameForm({
  initialName,
  onSubmit,
  onCancel,
}: SectionNameFormProps): JSX.Element {
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
        Section name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <button className="btn-primary" type="submit">
        Save
      </button>
      <button className="btn-quiet" type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
