import "./NowPanel.css";
import { useEffect, useState } from "react";

import {
  type CheckItem,
  fetchNowSelection,
  fetchNowSettings,
  type Task,
  updateCheckItem,
  updateNowSelection,
} from "../api";
import { Modal } from "./Modal";

interface NowPanelProps {
  /** The User's open Tasks, undated ones included: what the picker offers
   * and where the selected Task's title is read from. */
  tasks: Task[];
  /** Receives the parent Task a Check Item tick returns (issue #550). */
  onTaskChanged: (task: Task) => void;
  /** Completes the Task: offered once every Check Item is done. */
  onComplete: (task: Task) => void;
}

/** Now (issue #547): an optional panel inside Today holding the one Task
 * the User chose to do next. Loads its own toggle and selection, so it
 * renders nothing while the feature is off and Today stays as it was.
 * Choosing, replacing or removing writes only the selection. */
export function NowPanel({
  tasks,
  onTaskChanged,
  onComplete,
}: NowPanelProps): React.JSX.Element | null {
  const [enabled, setEnabled] = useState(false);
  const [taskId, setTaskId] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  // Announced only after the User advances, never on first render.
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    let live = true;
    void Promise.all([fetchNowSettings(), fetchNowSelection()]).then(([settings, selection]) => {
      if (live) {
        setEnabled(settings.enabled);
        setTaskId(selection.task_id);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  // Completing the Now Task (here or on another device) removes it from the
  // open Tasks or advances its schedule in place (recurring, ADR 0003); the
  // server prunes such a pick on read (issue #549), so ask again whenever the
  // chosen Task's occurrence changes and fall back to Choose a Task.
  const chosen = taskId === null ? undefined : tasks.find((t) => t.id === taskId);
  const occurrence =
    chosen === undefined
      ? "missing"
      : `${chosen.completed}|${chosen.start_date}|${chosen.due_date}`;
  useEffect(() => {
    if (!enabled || taskId === null) {
      return;
    }
    let live = true;
    void fetchNowSelection().then((selection) => {
      if (live) {
        setTaskId(selection.task_id);
      }
    });
    return () => {
      live = false;
    };
  }, [enabled, taskId, occurrence]);

  if (!enabled) {
    return null;
  }

  async function select(id: number | null): Promise<void> {
    setPicking(false);
    const saved = await updateNowSelection(id);
    setTaskId(saved.task_id);
  }

  async function tick(owner: Task, item: CheckItem): Promise<void> {
    // Never completes the Task: Now hands completion back to the User.
    const updated = await updateCheckItem(
      owner.id,
      item.id,
      { done: true },
      { autoComplete: false },
    );
    const nextOpen = updated.check_items.find((i) => !i.done);
    setAnnouncement(nextOpen === undefined ? "All Check Items done" : `Next: ${nextOpen.title}`);
    onTaskChanged(updated);
  }

  const task = chosen?.completed ? undefined : chosen;
  // Check Items arrive in their sort order; the first open one is the next step.
  const next = task?.check_items.find((item) => !item.done);
  const open = tasks.filter((t) => !t.completed);

  return (
    <section className="now-panel" aria-label="Now">
      <span className="now-label">Now</span>
      {task === undefined ? (
        <div className="now-body">
          <p className="now-empty">Pick the one Task to do next.</p>
          <button type="button" className="btn-secondary" onClick={() => setPicking(true)}>
            Choose a Task
          </button>
        </div>
      ) : (
        <div className="now-body">
          <div className="now-focus">
            <p className="now-title">{task.title}</p>
            {next !== undefined && (
              <label className="now-step">
                <input
                  type="checkbox"
                  checked={false}
                  aria-label={`Tick ${next.title}`}
                  onChange={() => void tick(task, next)}
                />
                <span>{next.title}</span>
              </label>
            )}
            {next === undefined && task.check_items.length > 0 && (
              <div className="now-step">
                <span className="now-empty">All Check Items done.</span>
                <button
                  type="button"
                  className="btn-secondary"
                  aria-label={`Complete ${task.title}`}
                  onClick={() => onComplete(task)}
                >
                  Complete Task
                </button>
              </div>
            )}
          </div>
          <div className="now-actions">
            <button type="button" className="btn-quiet" onClick={() => setPicking(true)}>
              Choose another
            </button>
            <button type="button" className="btn-quiet" onClick={() => void select(null)}>
              Remove from Now
            </button>
          </div>
        </div>
      )}
      <p role="status" className="visually-hidden">
        {announcement}
      </p>
      {picking && (
        <Modal title="Choose a Task for Now" onClose={() => setPicking(false)}>
          {open.length === 0 ? (
            <p className="now-empty">No open Tasks yet.</p>
          ) : (
            <ul className="now-picker">
              {open.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className="btn-quiet now-picker-option"
                    aria-pressed={t.id === taskId}
                    onClick={() => void select(t.id)}
                  >
                    {t.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </section>
  );
}
