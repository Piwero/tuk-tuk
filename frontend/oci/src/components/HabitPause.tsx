import "./HabitPause.css";
import { useState } from "react";

import { ApiError, type HabitPause, type HabitPauseInput } from "../api";
import { addDays, listDays, shortDayLabel } from "../dates";

/** What a refused pause write says. A conflict with Check-ins names their
 * dates, and says nothing was deleted: existing Check-ins stay
 * authoritative (issue #559). */
function pauseErrorText(error: unknown): string {
  if (error instanceof ApiError && error.code === "pause_conflicts_with_check_ins") {
    const details = error.details as { dates?: string[] } | undefined;
    return `Check-ins on ${listDays(details?.dates ?? [])} prevent this pause. Remove them or choose other dates; nothing was deleted.`;
  }
  if (error instanceof ApiError) {
    return error.message;
  }
  return "The pause could not be saved. Try again.";
}

/** The pause's interval in words: "Paused Jul 1 – Jul 10" or "Paused since
 * Jul 1, no end date"; a pause still to come is "planned". */
function intervalText(pause: HabitPause, today: string): string {
  if (pause.start_date > today) {
    return pause.end_date === null
      ? `Pause planned from ${shortDayLabel(pause.start_date)}, no end date`
      : `Pause planned ${shortDayLabel(pause.start_date)} – ${shortDayLabel(pause.end_date)}`;
  }
  return pause.end_date === null
    ? `Paused since ${shortDayLabel(pause.start_date)}, no end date`
    : `Paused ${shortDayLabel(pause.start_date)} – ${shortDayLabel(pause.end_date)}`;
}

interface HabitPauseStatusProps {
  habitName: string;
  pause: HabitPause;
  today: string;
  onEdit: () => void;
  onResume: () => void;
}

/** A paused Habit's status on its card: the explicit interval, the resume
 * date, and Edit pause / Resume today. Neutral, never red: a pause is a
 * choice, not a failure. */
export function HabitPauseStatus({
  habitName,
  pause,
  today,
  onEdit,
  onResume,
}: HabitPauseStatusProps): React.JSX.Element {
  const begun = pause.start_date <= today;
  return (
    <div role="status" aria-label={`${habitName} pause`} className="habit-pause-status">
      <p className="habit-pause-interval">
        {intervalText(pause, today)}
        {pause.end_date !== null && (
          <span className="habit-pause-resumes">
            {" · "}Resumes {shortDayLabel(addDays(pause.end_date, 1))}
          </span>
        )}
      </p>
      <p className="habit-pause-note">
        Paused days are skipped by the Streak, so it can differ from a perfect daily record.
      </p>
      <div className="habit-pause-actions">
        <button type="button" className="btn-secondary" onClick={onEdit}>
          Edit pause
        </button>
        {begun && (
          <button type="button" className="btn-secondary" onClick={onResume}>
            Resume today
          </button>
        )}
      </div>
    </div>
  );
}

interface HabitPauseFormProps {
  /** The form's accessible name: "Pause Meditate" or "Edit pause for Meditate". */
  label: string;
  /** The pause being edited, or undefined for a new one starting today. */
  initial?: HabitPause;
  today: string;
  onSave: (input: HabitPauseInput) => Promise<void>;
  onCancel: () => void;
}

/** Start or edit a pause: the first paused day and an optional last one
 * (blank is open-ended). A refused save keeps the attempted dates and says
 * why, beside the fields. */
export function HabitPauseForm({
  label,
  initial,
  today,
  onSave,
  onCancel,
}: HabitPauseFormProps): React.JSX.Element {
  const [start, setStart] = useState(initial?.start_date ?? today);
  const [end, setEnd] = useState(initial?.end_date ?? "");
  const [error, setError] = useState<string | null>(null);
  const errorId = `habit-pause-error-${label.replace(/\W+/g, "-")}`;

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (start === "") {
      return;
    }
    try {
      await onSave({ start_date: start, end_date: end === "" ? null : end });
    } catch (caught) {
      setError(pauseErrorText(caught));
    }
  }

  return (
    <form
      aria-label={label}
      className="habit-pause-form"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <label>
        First paused day
        <input
          type="date"
          required
          value={start}
          aria-describedby={error === null ? undefined : errorId}
          onChange={(event) => setStart(event.target.value)}
        />
      </label>
      <label>
        Last paused day (optional)
        <input
          type="date"
          value={end}
          min={start}
          aria-describedby={error === null ? undefined : errorId}
          onChange={(event) => setEnd(event.target.value)}
        />
      </label>
      <p className="habit-pause-hint">Leave the last day blank to pause until you resume.</p>
      {error !== null && (
        <p role="alert" id={errorId} className="habit-pause-error">
          {error}
        </p>
      )}
      <div className="habit-pause-actions">
        <button className="btn-primary" type="submit">
          Save pause
        </button>
        <button className="btn-secondary" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
