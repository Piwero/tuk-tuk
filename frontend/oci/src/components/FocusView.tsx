import { useCallback, useEffect, useRef, useState } from "react";

import {
  createTimer,
  deleteTimer,
  fetchHabits,
  fetchOpenTasks,
  fetchTimers,
  updateTimer,
  type FocusMode,
  type Habit,
  type Task,
  type Timer,
  type TimerCreateInput,
} from "../api";
import { linkOf, type FocusLink } from "../focusLink";
import { useFocusRun } from "../focusRunContext";
import { Icon } from "./Icon";
import { LinkSelect } from "./LinkSelect";
import { TimerForm } from "./TimerForm";

function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

interface FocusViewProps {
  /** Start a Pomo against this Task immediately (the task row's shortcut). */
  initialTask?: Task | null;
  /** Jumps to the statistics + history screen (its own route — #162). */
  onOpenStats: () => void;
}

/** The Focus screen: a client-side Pomo / Stopwatch timer whose finished runs
 * persist as Focus Sessions. A running (or just-finished) session is
 * distraction-free — the countdown is the only thing on screen, alongside
 * Pause/Resume, Finish, and Cancel; the Timers presets and statistics/history
 * live behind a tap so nothing else competes with the clock (#162). */
export function FocusView({ initialTask = null, onOpenStats }: FocusViewProps): JSX.Element {
  // The live run (ticking clock, pause/resume/finish/cancel) is shared with
  // the nav bar badge — this screen just supplies the pre-start
  // configuration and the Timers presets.
  const {
    running,
    pendingBreak,
    elapsedMs,
    remainingMs,
    start: startRun,
    pause,
    resume,
    finish,
    cancel,
    startBreak,
    skipBreak,
  } = useFocusRun();
  const [mode, setMode] = useState<FocusMode>(running?.mode ?? "pomo");
  const [pomoMinutes, setPomoMinutes] = useState(
    running !== null && running.mode === "pomo" ? String(running.pomoMs / 60_000) : "25",
  );
  const [breakMinutes, setBreakMinutes] = useState(
    running !== null && running.breakMs > 0 ? String(running.breakMs / 60_000) : "5",
  );
  const [longBreakMinutes, setLongBreakMinutes] = useState(
    running !== null && running.longBreakMs > 0 ? String(running.longBreakMs / 60_000) : "15",
  );
  const [link, setLink] = useState<FocusLink>(
    running !== null ? running.link : initialTask ? `task:${initialTask.id}` : "",
  );
  const [tasks, setTasks] = useState<Task[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [timers, setTimers] = useState<Timer[]>([]);
  const [timerEditor, setTimerEditor] = useState<
    { mode: "add" } | { mode: "edit"; id: number } | null
  >(null);

  const loadTimers = useCallback(async (): Promise<void> => {
    setTimers((await fetchTimers()).items);
  }, []);

  useEffect(() => {
    void loadTimers();
    void fetchOpenTasks().then((page) => setTasks(page.items));
    void fetchHabits().then((page) => setHabits(page.items.filter((habit) => !habit.is_archived)));
  }, [loadTimers]);

  function start(): void {
    startRun({
      mode,
      pomoMs: Number(pomoMinutes) * 60_000,
      breakMs: Number(breakMinutes) * 60_000,
      longBreakMs: Number(longBreakMinutes) * 60_000,
      link,
    });
  }

  /** One tap on a preset: adopt its mode / length / link and run. */
  function startFromTimer(timer: Timer): void {
    setMode(timer.mode);
    if (timer.mode === "pomo" && timer.duration_seconds !== null) {
      setPomoMinutes(String(timer.duration_seconds / 60));
    }
    const timerLink = linkOf(timer);
    setLink(timerLink);
    startRun({
      mode: timer.mode,
      pomoMs: (timer.duration_seconds ?? 0) * 1000,
      breakMs: Number(breakMinutes) * 60_000,
      longBreakMs: Number(longBreakMinutes) * 60_000,
      link: timerLink,
    });
  }

  async function handleAddTimer(values: TimerCreateInput): Promise<void> {
    await createTimer(values);
    setTimerEditor(null);
    await loadTimers();
  }

  async function handleEditTimer(timer: Timer, values: TimerCreateInput): Promise<void> {
    await updateTimer(timer.id, {
      name: values.name,
      mode: values.mode,
      duration_seconds: values.duration_seconds ?? null,
      task_id: values.task_id ?? null,
      habit_id: values.habit_id ?? null,
    });
    setTimerEditor(null);
    await loadTimers();
  }

  async function handleDeleteTimer(timer: Timer): Promise<void> {
    await deleteTimer(timer.id);
    await loadTimers();
  }

  // Start a Pomo against the passed task immediately — the task row's
  // shortcut. A restored run wins: it is real recorded focus time, so the
  // shortcut must not silently discard it.
  const autostart = useRef(initialTask);
  useEffect(() => {
    if (autostart.current !== null) {
      autostart.current = null;
      if (running === null) {
        start();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clockMs =
    pendingBreak !== null
      ? (pendingBreak.long ? Number(longBreakMinutes) : Number(breakMinutes)) * 60_000
      : running === null
        ? mode === "pomo"
          ? Number(pomoMinutes) * 60_000
          : 0
        : running.mode === "pomo"
          ? remainingMs
          : elapsedMs;

  return (
    <div className="focus-view">
      <div className="focus-timer">
        <p className="focus-clock">{formatClock(clockMs)}</p>
        {pendingBreak !== null ? (
          <div className="focus-break-offer">
            <p>
              {`Nice work. Time for ${pendingBreak.long ? "a long break" : "a break"} (${formatClock(clockMs)}).`}
            </p>
            <button type="button" onClick={startBreak}>
              {`Start ${pendingBreak.long ? "long break" : "break"}`}
            </button>
            <button type="button" onClick={skipBreak}>
              Skip
            </button>
          </div>
        ) : running === null ? (
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
              <>
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
                <label>
                  Break minutes
                  <input
                    type="number"
                    min={1}
                    aria-label="Break minutes"
                    value={breakMinutes}
                    onChange={(event) => setBreakMinutes(event.target.value)}
                  />
                </label>
                <label>
                  Long break minutes
                  <input
                    type="number"
                    min={1}
                    aria-label="Long break minutes"
                    value={longBreakMinutes}
                    onChange={(event) => setLongBreakMinutes(event.target.value)}
                  />
                </label>
              </>
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
            {running.phase === "break" && <p className="focus-break-label">On a break</p>}
            {running.pauseStartedAtMs === null ? (
              <button type="button" onClick={pause}>
                Pause
              </button>
            ) : (
              <button type="button" onClick={resume}>
                Resume
              </button>
            )}
            {running.phase === "break" ? (
              <button type="button" onClick={cancel}>
                Skip break
              </button>
            ) : (
              <>
                <button type="button" onClick={() => void finish()}>
                  Finish
                </button>
                <button type="button" className="focus-cancel" onClick={cancel}>
                  Cancel
                </button>
              </>
            )}
          </>
        )}
        {pendingBreak === null && running?.phase !== "break" && (
          <LinkSelect
            label="Link"
            tasks={tasks}
            habits={habits}
            value={link}
            disabled={running !== null}
            onChange={setLink}
          />
        )}
      </div>
      {/* Distraction-free while a session is running or a break is being
          offered: no presets, no config — just the clock and its controls. */}
      {running === null && pendingBreak === null && (
        <>
          <section className="focus-timers">
            <h2>Timers</h2>
            <ul aria-label="Timers">
              {timers.map((timer) =>
                timerEditor?.mode === "edit" && timerEditor.id === timer.id ? (
                  <li key={timer.id}>
                    <TimerForm
                      tasks={tasks}
                      habits={habits}
                      initial={timer}
                      onSubmit={(values) => void handleEditTimer(timer, values)}
                      onCancel={() => setTimerEditor(null)}
                    />
                  </li>
                ) : (
                  <li key={timer.id} className="focus-timer-preset">
                    <button
                      type="button"
                      aria-label={`Start timer ${timer.name}`}
                      disabled={running !== null}
                      onClick={() => startFromTimer(timer)}
                    >
                      {timer.name}
                    </button>
                    <span className="row-actions">
                      <button
                        type="button"
                        aria-label={`Edit timer ${timer.name}`}
                        onClick={() => setTimerEditor({ mode: "edit", id: timer.id })}
                      >
                        <Icon name="pencil" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete timer ${timer.name}`}
                        onClick={() => void handleDeleteTimer(timer)}
                      >
                        <Icon name="x" />
                      </button>
                    </span>
                  </li>
                ),
              )}
            </ul>
            {timerEditor?.mode === "add" ? (
              <TimerForm
                tasks={tasks}
                habits={habits}
                onSubmit={(values) => void handleAddTimer(values)}
                onCancel={() => setTimerEditor(null)}
              />
            ) : (
              <button type="button" onClick={() => setTimerEditor({ mode: "add" })}>
                Add Timer
              </button>
            )}
          </section>
          <a
            href="/focus/stats"
            className="focus-stats-link"
            onClick={(event) => {
              if (
                event.defaultPrevented ||
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey
              ) {
                return;
              }
              event.preventDefault();
              onOpenStats();
            }}
          >
            <Icon name="chart-column" size={16} />
            Statistics
          </a>
        </>
      )}
    </div>
  );
}
