import { useState } from "react";

import { createTask, type Task } from "../api";

interface QuickAddProps {
  listId: number;
  onCreated: (task: Task) => void;
}

export function QuickAdd({ listId, onCreated }: QuickAddProps): JSX.Element {
  const [title, setTitle] = useState("");

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed === "") {
      return;
    }
    const task = await createTask(trimmed, listId);
    onCreated(task);
    setTitle("");
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <input
        aria-label="Add a task"
        placeholder="Add a task…"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
    </form>
  );
}
