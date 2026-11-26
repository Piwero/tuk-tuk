// The skip controls reuse the pause's quiet status and form styles
// (HabitPause.css): a skip, like a pause, is a choice, never a failure.
import "./HabitPause.css";
import { useState } from "react";

import { ApiError } from "../api";
import { listDays, shortDayLabel } from "../dates";

/** What a refused skip says. A conflict with a Check-in names its date and
 * says nothing was deleted: existing Check-ins stay authoritative (issue
 * #564). */
function skipErrorText(error: unknown): string {
  if (error instanceof ApiError && error.code === "skip_conflicts_with_check_in") {
    const details = error.details as { dates?: string[] } | undefined;
    return `A Check-in on ${listDays(details?.dates ?? [])} prevents this skip. Remove it or choose another day; nothing was deleted.`;
  }
  if (error instanceof ApiError && error.code === "skip_not_scheduled") {
    return "That day is not scheduled, so there is nothing to skip.";
  }
  if (error instanceof ApiError && error.code === "habit_day_paused") {
    return "That day is paused, so it needs no skip.";
  }
  if (error instanceof ApiError) {
    return error.message;
  }
  return "The skip could not be saved. Try again.";
}

interface HabitSkipStatusProps {
  habitName: string;
  onUndo: () => void;
}

/** Today skipped, on the card: says so in words, with Undo skip. */
export function HabitSkipStatus({ habitName, onUndo }: HabitSkipStatusProps): React.JSX.Element {
  return (
    <div role="status" aria-label={`${habitName} skip`} className="habit-pause-status">
      <p className="habit-pause-interval">Skipped today</p>
      <p className="habit-pause-note">
        A skipped day is on purpose: not counted, neither done nor missed.
      </p>
      <div className="habit-pause-actions">
        <button type="button" className="btn-secondary" onClick={onUndo}>
          Undo skip
        </button>
      </div>
    </div>
  );
}

interface HabitSkipFormProps {
  habitName: string;
  today: string;
  /** The skipped days to offer Undo skip for (the month on screen). */
  skipped: string[];
  onSkip: (day: string) => Promise<void>;
  onUndo: (day: string) => Promise<void>;
}

/** Skip any one scheduled day, and undo the skips on screen. A refused skip
 * keeps the attempted day and says why, beside the field. */
export function HabitSkipForm({
  habitName,
  today,
  skipped,
  onSkip,
  onUndo,
}: HabitSkipFormProps): React.JSX.Element {
  const [day, setDay] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const label = `Skip a day of ${habitName}`;
  const errorId = `habit-skip-error-${habitName.replace(/\W+/g, "-")}`;

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (day === "") {
      return;
    }
    try {
      await onSkip(day);
      setError(null);
    } catch (caught) {
      setError(skipErrorText(caught));
    }
  }

  return (
    <form aria-label={label} className="habit-pause-form" onSubmit={(e) => void handleSubmit(e)}>
      <label>
        Day to skip
        <input
          type="date"
          required
          value={day}
          aria-describedby={error === null ? undefined : errorId}
          onChange={(event) => setDay(event.target.value)}
        />
      </label>
      <div className="habit-pause-actions">
        <button className="btn-secondary" type="submit">
          Skip day
        </button>
        {skipped.map((skippedDay) => (
          <button
            key={skippedDay}
            type="button"
            className="btn-quiet"
            onClick={() => void onUndo(skippedDay)}
          >
            Undo skip for {shortDayLabel(skippedDay)}
          </button>
        ))}
      </div>
      <p className="habit-pause-hint">
        Skip a scheduled day on purpose; unlike a missed day, it is not counted against the Streak.
      </p>
      {error !== null && (
        <p role="alert" id={errorId} className="habit-pause-error">
          {error}
        </p>
      )}
    </form>
  );
}
