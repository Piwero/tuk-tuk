import "./NowPanel.css";
import { useEffect, useState } from "react";

import { fetchNowSelection, fetchNowSettings, type Task, updateNowSelection } from "../api";
import { Modal } from "./Modal";

interface NowPanelProps {
  /** The User's open Tasks, undated ones included: what the picker offers
   * and where the selected Task's title is read from. */
  tasks: Task[];
}

/** Now (issue #547): an optional panel inside Today holding the one Task
 * the User chose to do next. Loads its own toggle and selection, so it
 * renders nothing while the feature is off and Today stays as it was.
 * Choosing, replacing or removing writes only the selection. */
export function NowPanel({ tasks }: NowPanelProps): React.JSX.Element | null {
  const [enabled, setEnabled] = useState(false);
  const [taskId, setTaskId] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);

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

  const task = chosen?.completed ? undefined : chosen;
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
          <p className="now-title">{task.title}</p>
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
