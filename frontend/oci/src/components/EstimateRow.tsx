import "./PlannedWorkRow.css";
import { useId, useState } from "react";

import { ApiError, updateTask, type Task } from "../api";
import { formatMinutes } from "../dates";
import { PropertyRow } from "./PropertyRow";

interface EstimateRowProps {
  task: Task;
  onTaskChanged: (task: Task) => void;
}

/** Task detail's Estimate row (#563): how long the User expects the work
 * to take, in minutes. Optional and never asked for elsewhere (not in
 * Quick-Add), never inferred from Focus. Used only for work planning: the
 * capacity summary counts it, and a new Planned work block starts from it. */
export function EstimateRow({ task, onTaskChanged }: EstimateRowProps): React.JSX.Element {
  const estimate = task.estimate_minutes ?? null;

  async function remove(close: () => void): Promise<void> {
    onTaskChanged(await updateTask(task.id, { estimate_minutes: null }));
    close();
  }

  return (
    <PropertyRow
      label="Estimate"
      quiet={estimate === null}
      value={estimate === null ? "No estimate" : formatMinutes(estimate)}
    >
      {(close) => (
        <EstimateForm
          task={task}
          onSaved={(saved) => {
            onTaskChanged(saved);
            close();
          }}
          onRemove={estimate === null ? null : () => void remove(close)}
        />
      )}
    </PropertyRow>
  );
}

interface EstimateFormProps {
  task: Task;
  onSaved: (task: Task) => void;
  onRemove: (() => void) | null;
}

function EstimateForm({ task, onSaved, onRemove }: EstimateFormProps): React.JSX.Element {
  const [minutes, setMinutes] = useState(
    task.estimate_minutes == null ? "" : String(task.estimate_minutes),
  );
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  async function save(): Promise<void> {
    const value = Number(minutes);
    if (minutes === "" || !Number.isInteger(value) || value < 1) {
      setError("Enter a whole number of minutes, at least 1.");
      return;
    }
    try {
      onSaved(await updateTask(task.id, { estimate_minutes: value }));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Couldn't save the estimate.");
    }
  }

  return (
    <form
      className="planned-work-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="planned-work-fields">
        <label>
          Estimate (minutes)
          <input
            type="number"
            min={1}
            step={1}
            value={minutes}
            aria-describedby={error === null ? undefined : errorId}
            onChange={(event) => setMinutes(event.target.value)}
          />
        </label>
      </div>
      {error !== null && (
        <p className="planned-work-error" role="alert" id={errorId}>
          {error}
        </p>
      )}
      <p className="planned-work-note">Only for planning. It never changes the due date.</p>
      <div className="planned-work-actions">
        <button className="btn-primary" type="submit">
          Save estimate
        </button>
        {onRemove !== null && (
          <button className="btn-secondary" type="button" onClick={onRemove}>
            Remove estimate
          </button>
        )}
      </div>
    </form>
  );
}
