import { useState } from "react";

import { type FocusMode, type FocusSession, type Habit, type Task } from "../api";
import { localDayOf, localTimeOf } from "../dates";
import { linkOf, type FocusLink } from "../focusLink";
import { LinkSelect } from "./LinkSelect";

export interface FocusSessionFormValues {
  mode: FocusMode;
  started_at: string;
  ended_at: string;
  note: string;
  link: FocusLink;
}

export interface FocusSessionFormProps {
  tasks: Task[];
  habits: Habit[];
  /** Editing an existing session; absent means adding a past one. */
  initial?: FocusSession;
  onSubmit: (values: FocusSessionFormValues) => void;
  onCancel: () => void;
}

/** An instant as a datetime-local input value (local wall clock). */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  return `${localDayOf(date)}T${localTimeOf(date)}`;
}

/** The form behind "Add session" and per-row editing: times, note and link
 * (the mode is chosen only when adding — an existing session keeps its own). */
export function FocusSessionForm({
  tasks,
  habits,
  initial,
  onSubmit,
  onCancel,
}: FocusSessionFormProps): JSX.Element {
  const [mode, setMode] = useState<FocusMode>(initial?.mode ?? "pomo");
  const [started, setStarted] = useState(initial ? toLocalInput(initial.started_at) : "");
  const [ended, setEnded] = useState(initial ? toLocalInput(initial.ended_at) : "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [link, setLink] = useState<FocusLink>(initial ? linkOf(initial) : "");

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (started === "" || ended === "") {
      return;
    }
    const startedAt = new Date(started);
    const endedAt = new Date(ended);
    if (endedAt.getTime() <= startedAt.getTime()) {
      return;
    }
    onSubmit({
      mode,
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      note: note.trim(),
      link,
    });
  }

  return (
    <form className="focus-session-form" onSubmit={handleSubmit}>
      {initial === undefined && (
        <label>
          Mode
          <select
            aria-label="Session mode"
            value={mode}
            onChange={(event) => setMode(event.target.value as FocusMode)}
          >
            <option value="pomo">Pomo</option>
            <option value="stopwatch">Stopwatch</option>
          </select>
        </label>
      )}
      <label>
        Started
        <input
          type="datetime-local"
          aria-label="Started"
          value={started}
          onChange={(event) => setStarted(event.target.value)}
        />
      </label>
      <label>
        Ended
        <input
          type="datetime-local"
          aria-label="Ended"
          value={ended}
          onChange={(event) => setEnded(event.target.value)}
        />
      </label>
      <label>
        Note
        <input aria-label="Note" value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <LinkSelect
        label="Session link"
        tasks={tasks}
        habits={habits}
        value={link}
        onChange={setLink}
      />
      <button type="submit">Save</button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
