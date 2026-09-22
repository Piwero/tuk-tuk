import { useCallback, useEffect, useId, useRef, useState } from "react";

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
import { Hint } from "./Hint";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { LinkSelect } from "./LinkSelect";
import { TimerForm } from "./TimerForm";

function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

/** The name of the Task or Habit a run is linked to, for the stage. */
function linkLabel(link: FocusLink, tasks: Task[], habits: Habit[]): string | null {
  if (link.startsWith("task:")) {
    return tasks.find((task) => task.id === Number(link.slice(5)))?.title ?? null;
  }
  if (link.startsWith("habit:")) {
    return habits.find((habit) => habit.id === Number(link.slice(6)))?.name ?? null;
  }
  return null;
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
  const cancelNoteId = useId();

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

  const progress =
    running !== null && running.pomoMs > 0
      ? Math.min(1, Math.max(0, elapsedMs / running.pomoMs))
      : 0;
  const showDial = running !== null && running.mode === "pomo";
  const stageTask = running !== null ? linkLabel(running.link, tasks, habits) : null;
  const paused = running !== null && running.pauseStartedAtMs !== null;

  // One line above the clock saying which of the five states the stage is
  // in. The dial alone can't say "paused" or "break" — and without it the
  // idle screen and a running one look like the same screen (#162).
  const phaseLabel =
    pendingBreak !== null
      ? "Break up next"
      : running === null
        ? mode === "pomo"
          ? "Pomo"
          : "Stopwatch"
        : paused
          ? "Paused"
          : running.phase === "break"
            ? "On a break"
            : running.mode === "pomo"
              ? "Focusing"
              : "Stopwatch";

  return (
    <div className="focus-view">
      {/* The stage: clock, the Task being focused on, and the pause/finish/
          cancel decisions as one group. The dial shows progress statically —
          Focus does not animate (design-system "Interaction"). The dial's
          box is always reserved, idle included, so pressing Start changes
          what the ring says rather than where everything sits. */}
      <div className="focus-stage" data-phase={paused ? "paused" : (running?.phase ?? "idle")}>
        <p className="focus-phase">{phaseLabel}</p>
        <div className={showDial || running === null ? "focus-dial has-ring" : "focus-dial"}>
          {(showDial || running === null) && (
            <svg className="focus-dial-ring" viewBox="0 0 120 120" aria-hidden="true">
              <circle className="focus-dial-track" cx="60" cy="60" r="54" pathLength={1} />
              {showDial && (
                <circle
                  className="focus-dial-progress"
                  cx="60"
                  cy="60"
                  r="54"
                  pathLength={1}
                  strokeDasharray={1}
                  strokeDashoffset={1 - progress}
                />
              )}
            </svg>
          )}
          <p className="focus-clock">{formatClock(clockMs)}</p>
        </div>
        {stageTask !== null && (
          <p className="focus-stage-task">
            Focusing on <strong>{stageTask}</strong>
          </p>
        )}
        <div className="focus-timer">
          {pendingBreak !== null ? (
            <div className="focus-break-offer">
              <p>
                {`Nice work. Time for ${pendingBreak.long ? "a long break" : "a break"} (${formatClock(clockMs)}).`}
              </p>
              <div className="focus-actions">
                <button type="button" onClick={startBreak}>
                  {`Start ${pendingBreak.long ? "long break" : "break"}`}
                </button>
                <button type="button" className="focus-secondary" onClick={skipBreak}>
                  Skip
                </button>
              </div>
            </div>
          ) : running === null ? (
            <>
              {/* Setup reads top-down as one short form — what kind of
                  session, how long, what it is for — instead of a wrapping
                  row of controls orbiting the clock. */}
              <div className="focus-setup">
                <Hint hintKey="focus-mode">
                  <label className="focus-field">
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
                </Hint>
                {mode === "pomo" && (
                  <div className="focus-lengths">
                    <Hint hintKey="pomo">
                      <label className="focus-field">
                        Pomo
                        <input
                          type="number"
                          min={1}
                          aria-label="Pomo minutes"
                          value={pomoMinutes}
                          onChange={(event) => setPomoMinutes(event.target.value)}
                        />
                      </label>
                    </Hint>
                    <Hint hintKey="break-minutes">
                      <label className="focus-field">
                        Break
                        <input
                          type="number"
                          min={1}
                          aria-label="Break minutes"
                          value={breakMinutes}
                          onChange={(event) => setBreakMinutes(event.target.value)}
                        />
                      </label>
                    </Hint>
                    <Hint hintKey="long-break-minutes">
                      <label className="focus-field">
                        Long break
                        <input
                          type="number"
                          min={1}
                          aria-label="Long break minutes"
                          value={longBreakMinutes}
                          onChange={(event) => setLongBreakMinutes(event.target.value)}
                        />
                      </label>
                    </Hint>
                    <p className="focus-lengths-unit">Minutes</p>
                  </div>
                )}
                <Hint hintKey="focus-link">
                  <LinkSelect
                    label="Link"
                    className="focus-field"
                    tasks={tasks}
                    habits={habits}
                    value={link}
                    onChange={setLink}
                  />
                </Hint>
              </div>
              <div className="focus-actions">
                <button
                  type="button"
                  className="focus-primary"
                  onClick={start}
                  disabled={mode === "pomo" && Number(pomoMinutes) < 1}
                >
                  Start
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="focus-actions">
                {running.pauseStartedAtMs === null ? (
                  <button type="button" className="focus-secondary" onClick={pause}>
                    Pause
                  </button>
                ) : (
                  <button type="button" className="focus-secondary" onClick={resume}>
                    Resume
                  </button>
                )}
                {running.phase === "break" ? (
                  <button type="button" className="focus-secondary" onClick={cancel}>
                    Skip break
                  </button>
                ) : (
                  <button type="button" className="focus-primary" onClick={() => void finish()}>
                    Finish
                  </button>
                )}
              </div>
              {/* Cancel is the quiet way out, kept off the main action row so
                  it can never be mistaken for Finish. Its consequence is a
                  described-by sibling, not part of the label: the button's
                  accessible name stays exactly "Cancel", and the warning
                  still reaches assistive tech. */}
              {running.phase !== "break" && (
                <p className="focus-cancel-row">
                  <button
                    type="button"
                    className="focus-cancel"
                    aria-describedby={cancelNoteId}
                    onClick={cancel}
                  >
                    Cancel
                  </button>
                  <span className="focus-cancel-note" id={cancelNoteId}>
                    Records nothing
                  </span>
                </p>
              )}
            </>
          )}
        </div>
      </div>
      {/* Presets and statistics sit beside the stage while idle, and step
          aside entirely while a session runs or a break is offered. */}
      {running === null && pendingBreak === null && (
        <aside className="focus-aside">
          <section className="focus-timers">
            <Hint hintKey="timers-panel">
              <h2 tabIndex={0}>Timers</h2>
            </Hint>
            {timers.length === 0 && timerEditor === null && (
              <p className="focus-timers-empty">
                No saved Timers yet. Add one to start a session in a tap.
              </p>
            )}
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
                    <Hint hintKey="start-timer">
                      <button
                        type="button"
                        aria-label={`Start timer ${timer.name}`}
                        disabled={running !== null}
                        onClick={() => startFromTimer(timer)}
                      >
                        {timer.name}
                      </button>
                    </Hint>
                    <span className="row-actions">
                      <IconButton
                        icon="pencil"
                        label={`Edit timer ${timer.name}`}
                        onClick={() => setTimerEditor({ mode: "edit", id: timer.id })}
                      />
                      <IconButton
                        icon="x"
                        label={`Delete timer ${timer.name}`}
                        onClick={() => void handleDeleteTimer(timer)}
                      />
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
              /* Add and Statistics share the card's foot: both are things you
                 do *around* a session, not part of starting one. */
              <div className="focus-timers-footer">
                <Hint hintKey="add-timer">
                  <button type="button" onClick={() => setTimerEditor({ mode: "add" })}>
                    <Icon name="plus" size={16} />
                    Add Timer
                  </button>
                </Hint>
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
              </div>
            )}
          </section>
        </aside>
      )}
    </div>
  );
}
