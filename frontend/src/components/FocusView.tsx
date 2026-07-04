import { useCallback, useEffect, useRef, useState } from "react";

import {
  createFocusSession,
  deleteFocusSession,
  fetchFocusSessions,
  fetchHabits,
  fetchOpenTasks,
  updateFocusSession,
  type FocusMode,
  type FocusSession,
  type Habit,
  type Task,
} from "../api";
import { linkFields, type FocusLink } from "../focusLink";
import { FocusSessionForm, type FocusSessionFormValues } from "./FocusSessionForm";
import { LinkSelect } from "./LinkSelect";

function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

interface RunningSession {
  mode: FocusMode;
  /** The Pomo length this run counts down from (frozen at start). */
  pomoMs: number;
  startedAtMs: number;
  /** Completed pause time so far, excluding a pause still in progress. */
  pausedMs: number;
  pauseStartedAtMs: number | null;
}

interface FocusViewProps {
  /** Start a Pomo against this Task immediately (the task row's shortcut). */
  initialTask?: Task | null;
}

/** The Focus screen: a client-side Pomo / Stopwatch timer whose finished
 * runs persist as Focus Sessions, and the session history with retroactive
 * add and edit. Pause time is tracked separately — recorded focus time is
 * honest. */
export function FocusView({ initialTask = null }: FocusViewProps): JSX.Element {
  const [mode, setMode] = useState<FocusMode>("pomo");
  const [pomoMinutes, setPomoMinutes] = useState("25");
  const [link, setLink] = useState<FocusLink>(initialTask ? `task:${initialTask.id}` : "");
  const [running, setRunning] = useState<RunningSession | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [editor, setEditor] = useState<{ mode: "add" } | { mode: "edit"; id: number } | null>(null);
  const finishing = useRef(false);

  const loadSessions = useCallback(async (): Promise<void> => {
    setSessions((await fetchFocusSessions()).items);
  }, []);

  useEffect(() => {
    void loadSessions();
    void fetchOpenTasks().then((page) => setTasks(page.items));
    void fetchHabits().then((page) => setHabits(page.items.filter((habit) => !habit.is_archived)));
  }, [loadSessions]);

  function start(): void {
    setRunning({
      mode,
      pomoMs: Number(pomoMinutes) * 60_000,
      startedAtMs: Date.now(),
      pausedMs: 0,
      pauseStartedAtMs: null,
    });
    finishing.current = false;
  }

  // Start a Pomo against the passed task immediately — the task row's shortcut.
  const autostart = useRef(initialTask);
  useEffect(() => {
    if (autostart.current !== null) {
      autostart.current = null;
      start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The clock: one tick a second while a timer runs.
  useEffect(() => {
    if (running === null) {
      return;
    }
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const elapsedMs =
    running === null
      ? 0
      : (running.pauseStartedAtMs ?? nowMs) - running.startedAtMs - running.pausedMs;
  const remainingMs = running === null ? 0 : running.pomoMs - elapsedMs;

  const finish = useCallback(async (): Promise<void> => {
    if (running === null || finishing.current) {
      return;
    }
    finishing.current = true;
    const endMs = Date.now();
    const pausedTotalMs =
      running.pausedMs + (running.pauseStartedAtMs === null ? 0 : endMs - running.pauseStartedAtMs);
    try {
      await createFocusSession({
        mode: running.mode,
        ...linkFields(link),
        started_at: new Date(running.startedAtMs).toISOString(),
        ended_at: new Date(endMs).toISOString(),
        pause_seconds: Math.round(pausedTotalMs / 1000),
      });
      setRunning(null);
      await loadSessions();
    } finally {
      // A failed save must not wedge the timer: the guard lifts so the next
      // tick (or tap) retries the finish.
      finishing.current = false;
    }
  }, [running, link, loadSessions]);

  // A Pomo finishes itself when the countdown reaches zero.
  useEffect(() => {
    if (running !== null && running.mode === "pomo" && remainingMs <= 0) {
      void finish();
    }
  }, [running, remainingMs, finish]);

  function pause(): void {
    if (running !== null && running.pauseStartedAtMs === null) {
      setRunning({ ...running, pauseStartedAtMs: Date.now() });
    }
  }

  function resume(): void {
    if (running !== null && running.pauseStartedAtMs !== null) {
      setRunning({
        ...running,
        pausedMs: running.pausedMs + (Date.now() - running.pauseStartedAtMs),
        pauseStartedAtMs: null,
      });
    }
  }

  const clockMs =
    running === null
      ? mode === "pomo"
        ? Number(pomoMinutes) * 60_000
        : 0
      : running.mode === "pomo"
        ? remainingMs
        : elapsedMs;

  const linkName = (session: FocusSession): string | null => {
    if (session.task_id !== null) {
      return tasks.find((task) => task.id === session.task_id)?.title ?? null;
    }
    if (session.habit_id !== null) {
      return habits.find((habit) => habit.id === session.habit_id)?.name ?? null;
    }
    return null;
  };

  async function handleAdd(values: FocusSessionFormValues): Promise<void> {
    await createFocusSession({
      mode: values.mode,
      ...linkFields(values.link),
      started_at: values.started_at,
      ended_at: values.ended_at,
      note: values.note,
    });
    setEditor(null);
    await loadSessions();
  }

  async function handleEdit(session: FocusSession, values: FocusSessionFormValues): Promise<void> {
    const fields = linkFields(values.link);
    await updateFocusSession(session.id, {
      started_at: values.started_at,
      ended_at: values.ended_at,
      note: values.note,
      task_id: fields.task_id ?? null,
      habit_id: fields.habit_id ?? null,
    });
    setEditor(null);
    await loadSessions();
  }

  async function handleDelete(session: FocusSession): Promise<void> {
    await deleteFocusSession(session.id);
    await loadSessions();
  }

  return (
    <div className="focus-view">
      <div className="focus-timer">
        <p className="focus-clock">{formatClock(clockMs)}</p>
        {running === null ? (
          <>
            <label>
              Mode
              <select
                aria-label="Mode"
                value={mode}
                onChange={(event) => setMode(event.target.value as FocusMode)}
              >
                <option value="pomo">Pomo</option>
                <option value="stopwatch">Stopwatch</option>
              </select>
            </label>
            {mode === "pomo" && (
              <label>
                Pomo minutes
                <input
                  type="number"
                  min={1}
                  aria-label="Pomo minutes"
                  value={pomoMinutes}
                  onChange={(event) => setPomoMinutes(event.target.value)}
                />
              </label>
            )}
            <button
              type="button"
              onClick={start}
              disabled={mode === "pomo" && Number(pomoMinutes) < 1}
            >
              Start
            </button>
          </>
        ) : (
          <>
            {running.pauseStartedAtMs === null ? (
              <button type="button" onClick={pause}>
                Pause
              </button>
            ) : (
              <button type="button" onClick={resume}>
                Resume
              </button>
            )}
            <button type="button" onClick={() => void finish()}>
              Finish
            </button>
          </>
        )}
        <LinkSelect
          label="Link"
          tasks={tasks}
          habits={habits}
          value={link}
          disabled={running !== null}
          onChange={setLink}
        />
      </div>
      <section className="focus-history">
        <h2>Sessions</h2>
        <ul aria-label="Focus Sessions">
          {sessions.map((session) => {
            if (editor?.mode === "edit" && editor.id === session.id) {
              return (
                <li key={session.id}>
                  <FocusSessionForm
                    tasks={tasks}
                    habits={habits}
                    initial={session}
                    onSubmit={(values) => void handleEdit(session, values)}
                    onCancel={() => setEditor(null)}
                  />
                </li>
              );
            }
            const linked = linkName(session);
            return (
              <li key={session.id} className="focus-session">
                <span className="focus-mode">{session.mode}</span>
                <span className="focus-duration">
                  {Math.round(session.duration_seconds / 60)} min
                </span>
                {linked !== null && <span className="focus-link">{linked}</span>}
                {session.note !== "" && <span className="focus-note">{session.note}</span>}
                <span className="row-actions">
                  <button
                    type="button"
                    aria-label="Edit session"
                    onClick={() => setEditor({ mode: "edit", id: session.id })}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    aria-label="Delete session"
                    onClick={() => void handleDelete(session)}
                  >
                    ✕
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
        {editor?.mode === "add" ? (
          <FocusSessionForm
            tasks={tasks}
            habits={habits}
            onSubmit={(values) => void handleAdd(values)}
            onCancel={() => setEditor(null)}
          />
        ) : (
          <button type="button" onClick={() => setEditor({ mode: "add" })}>
            Add session
          </button>
        )}
      </section>
    </div>
  );
}
