import "./PlannedWorkRow.css";
import { useId, useState } from "react";

import { ApiError, updatePlannedWork, type PlannedWorkRead, type Task } from "../api";
import {
  browserTimeZone,
  dueDay,
  formatSchedule,
  instantOf,
  localDayOf,
  zonedDay,
  zonedTime,
} from "../dates";
import { PropertyRow } from "./PropertyRow";

interface PlannedWorkRowProps {
  task: Task;
  onTaskChanged: (task: Task) => void;
}

/** Task detail's Planned work row (#558): optional reserved work time, a
 * separate row from the Due date. Edited with date/time form controls;
 * saving or removing the block never touches the deadline. Times are read
 * and written in the browser's timezone, like the Date row. */
export function PlannedWorkRow({ task, onTaskChanged }: PlannedWorkRowProps): React.JSX.Element {
  const [removed, setRemoved] = useState(false);
  const plan = task.planned_work ?? null;

  async function remove(close: () => void): Promise<void> {
    onTaskChanged(await updatePlannedWork(task.id, null));
    close();
    setRemoved(true);
  }

  return (
    <div className="planned-work-row">
      <PropertyRow
        label="Planned work"
        quiet={plan === null}
        value={plan === null ? "No plan" : planLabel(plan)}
      >
        {(close) => (
          <PlannedWorkForm
            task={task}
            onSaved={(saved) => {
              onTaskChanged(saved);
              setRemoved(false);
              close();
            }}
            onRemove={plan === null ? null : () => void remove(close)}
          />
        )}
      </PropertyRow>
      {plan !== null && plan.buffer_minutes !== null && plan.buffer_minutes > 0 && (
        <span className="planned-work-buffer">Buffer after {plan.buffer_minutes} min</span>
      )}
      {removed && plan === null && (
        <p className="planned-work-status" role="status">
          Plan removed. The Task and its due date remain saved.
        </p>
      )}
    </div>
  );
}

function planLabel(plan: PlannedWorkRead): string {
  return (
    formatSchedule({ start_date: plan.start, due_date: plan.end, is_all_day: false }, "detail") ??
    ""
  );
}

interface Draft {
  day: string;
  start: string;
  duration: string;
  buffer: string;
}

function draftOf(task: Task): Draft {
  const plan = task.planned_work ?? null;
  if (plan === null) {
    return {
      day: dueDay(task) ?? localDayOf(new Date()),
      start: "09:00",
      duration: "60",
      buffer: "",
    };
  }
  return {
    day: zonedDay(plan.start, null),
    start: zonedTime(plan.start, null),
    duration: String(plan.duration_minutes),
    buffer: plan.buffer_minutes === null ? "" : String(plan.buffer_minutes),
  };
}

interface PlannedWorkFormProps {
  task: Task;
  onSaved: (task: Task) => void;
  onRemove: (() => void) | null;
}

/** Mounted while the row's popover is open: the draft keeps the attempted
 * values when a save is rejected, so the error can be fixed in place. */
function PlannedWorkForm({ task, onSaved, onRemove }: PlannedWorkFormProps): React.JSX.Element {
  const [draft, setDraft] = useState(() => draftOf(task));
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  async function save(): Promise<void> {
    if (draft.day === "" || draft.start === "" || draft.duration === "") {
      setError("Choose a day, a start time and a duration.");
      return;
    }
    try {
      onSaved(
        await updatePlannedWork(task.id, {
          start: instantOf(draft.day, draft.start),
          duration_minutes: Number(draft.duration),
          time_zone: browserTimeZone(),
          buffer_minutes: draft.buffer === "" ? null : Number(draft.buffer),
        }),
      );
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Couldn't save the plan.");
    }
  }

  const field = (key: keyof Draft) => ({
    value: draft[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setDraft({ ...draft, [key]: event.target.value }),
  });

  return (
    <form
      className="planned-work-form"
      aria-describedby={error === null ? undefined : errorId}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="planned-work-fields">
        <label>
          Day
          <input type="date" {...field("day")} />
        </label>
        <label>
          Start
          <input type="time" {...field("start")} />
        </label>
        <label>
          Duration (minutes)
          <input type="number" min={1} step={1} {...field("duration")} />
        </label>
        <label>
          Buffer after (minutes)
          <input type="number" min={0} step={1} {...field("buffer")} />
        </label>
      </div>
      {error !== null && (
        <p className="planned-work-error" role="alert" id={errorId}>
          {error}
        </p>
      )}
      <p className="planned-work-note">Moving this block will not change the due date.</p>
      <div className="planned-work-actions">
        <button className="btn-primary" type="submit">
          Save plan
        </button>
        {onRemove !== null && (
          <button className="btn-secondary" type="button" onClick={onRemove}>
            Remove plan
          </button>
        )}
      </div>
    </form>
  );
}
