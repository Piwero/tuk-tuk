import { useState } from "react";

import { ApiError } from "../api";

/** Names a Repository View (#580): the sidebar's "New view" form. */
export function RepositoryViewNameForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}): React.JSX.Element {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    const trimmed = name.trim();
    if (trimmed === "") return;
    try {
      await onSubmit(trimmed);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "Something went wrong");
    }
  }

  return (
    <form
      className="list-form"
      aria-label="New Repository View"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label>
        View name
        <input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      {error !== null && <p role="alert">{error}</p>}
      <button className="btn-primary" type="submit">
        Create
      </button>
      <button className="btn-quiet" type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
