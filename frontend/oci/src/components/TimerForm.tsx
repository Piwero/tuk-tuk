import { useState } from "react";

import { type FocusMode, type Habit, type Task, type Timer, type TimerCreateInput } from "../api";
import { linkFields, linkOf, type FocusLink } from "../focusLink";
import { LinkSelect } from "./LinkSelect";

export interface TimerFormProps {
  tasks: Task[];
  habits: Habit[];
  /** Editing an existing Timer; absent means creating one. */
  initial?: Timer;
  onSubmit: (values: TimerCreateInput) => void;
  onCancel: () => void;
}

/** The form behind "Add Timer" and per-preset editing: name, mode, the Pomo
 * length, and the optional pre-link. */
export function TimerForm({
  tasks,
  habits,
  initial,
  onSubmit,
  onCancel,
}: TimerFormProps): JSX.Element {
  const [name, setName] = useState(initial?.name ?? "");
  const [mode, setMode] = useState<FocusMode>(initial?.mode ?? "pomo");
  const [minutes, setMinutes] = useState(
    initial?.duration_seconds != null ? String(initial.duration_seconds / 60) : "25",
  );
  const [link, setLink] = useState<FocusLink>(initial ? linkOf(initial) : "");

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    const trimmed = name.trim();
    const minutesNumber = Number(minutes);
    if (trimmed === "") {
      return;
    }
    if (mode === "pomo" && !(minutesNumber > 0)) {
      return;
    }
    onSubmit({
      name: trimmed,
      mode,
      ...(mode === "pomo" ? { duration_seconds: Math.round(minutesNumber * 60) } : {}),
      ...linkFields(link),
    });
  }

  return (
    <form className="timer-form" onSubmit={handleSubmit}>
      <label>
        Timer name
        <input
          aria-label="Timer name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        Timer mode
        <select
          aria-label="Timer mode"
          value={mode}
          onChange={(event) => setMode(event.target.value as FocusMode)}
        >
          <option value="pomo">Pomo</option>
          <option value="stopwatch">Stopwatch</option>
        </select>
      </label>
      {mode === "pomo" && (
        <label>
          Timer minutes
          <input
            type="number"
            min={1}
            aria-label="Timer minutes"
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
          />
        </label>
      )}
      <LinkSelect
        label="Timer link"
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
