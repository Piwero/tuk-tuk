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
import { useFocusRun } from "../focusRunContext";
import { Modal } from "./Modal";
import { TimerFreeWork } from "./TimerFreeWork";

/** Start 5 min (#552): a deliberately small first step. */
const FIVE_MINUTES_MS = 5 * 60_000;

interface NowPanelProps {
  /** The User's open Tasks, undated ones included: what the picker offers
   * and where the selected Task's title is read from. */
  tasks: Task[];
  /** Receives the parent Task a Check Item tick returns (issue #550). */
  onTaskChanged: (task: Task) => void;
  /** Completes the Task: offered once every Check Item is done. */
  onComplete: (task: Task) => void;
  /** Shows the Focus screen, where a started session runs. */
  onOpenFocus: () => void;
}

/** Now (issue #547): an optional panel inside Today holding the one Task
 * the User chose to do next. Loads its own toggle and selection, so it
 * renders nothing while the feature is off and Today stays as it was.
 * Choosing, replacing or removing writes only the selection. */
export function NowPanel({
  tasks,
  onTaskChanged,
  onComplete,
  onOpenFocus,
}: NowPanelProps): React.JSX.Element | null {
  const [enabled, setEnabled] = useState(false);
  const [taskId, setTaskId] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const [timerFree, setTimerFree] = useState(false);
  // Announced only after the User advances, never on first render.
  const [announcement, setAnnouncement] = useState("");
  const { running, start, pause } = useFocusRun();
  // Set when Start 5 min meets a session already running: one session at a
  // time, so the panel offers that session back instead of a second one.
  const [conflict, setConflict] = useState(false);

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

  function startFive(owner: Task): void {
    if (running !== null) {
      setConflict(true);
      return;
    }
    start({ mode: "pomo", pomoMs: FIVE_MINUTES_MS, link: `task:${owner.id}` });
    onOpenFocus();
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
          {conflict && running !== null && (
            <div className="now-conflict">
              <p>A Focus Session is already running.</p>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setConflict(false);
                  onOpenFocus();
                }}
              >
                Return to Focus
              </button>
              {running.pauseStartedAtMs === null && (
                <button
                  type="button"
                  className="btn-quiet"
                  onClick={() => {
                    pause();
                    setConflict(false);
                    setAnnouncement("Focus Session paused");
                  }}
                >
                  Pause it
                </button>
              )}
            </div>
          )}
          <div className="now-actions">
            <button type="button" className="btn-primary now-start" onClick={() => startFive(task)}>
              Start 5 min
            </button>
            <button
              type="button"
              className="btn-secondary now-secondary"
              onClick={() => setTimerFree(true)}
            >
              Work without timer
            </button>
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
      {timerFree && task !== undefined && (
        <TimerFreeWork
          task={task}
          onTick={(owner, item) => void tick(owner, item)}
          onComplete={onComplete}
          onLeave={() => setTimerFree(false)}
        />
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
