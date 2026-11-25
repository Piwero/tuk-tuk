import { EmptyState, LoadError, SkeletonRows } from "./TaskViewState";
import "./FocusView.css";
import { useCallback, useEffect, useId, useState } from "react";

import {
  createTimer,
  deleteTimer,
  fetchHabits,
  fetchOpenTasks,
  fetchSmartTasks,
  fetchTimers,
  updateTimer,
  type FocusDayTotal,
  type FocusMode,
  type Habit,
  type Task,
  type Timer,
  type TimerCreateInput,
} from "../api";
import { addDays, localDayOf, shortDayLabel } from "../dates";
import { linkOf, type FocusLink } from "../focusLink";
import { formatFocusTotal, loadFocusDays, pomoOfCycle } from "../focusTotals";
import { useRegisterShortcut } from "../shortcuts";
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

/** The last seven days ending today, with each day's focus seconds. */
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
  /** Link this Task on arrival — a row's or palette's Focus action (#449).
   * The clock waits for Start. */
  initialTask?: Task | null;
  /** Jumps to the statistics + history screen (its own route — #162). */
  onOpenStats: () => void;
}

/** The Focus screen: a client-side Pomo / Stopwatch timer whose finished runs
 * persist as Focus Sessions. A running (or just-finished) session is
 * distraction-free — the countdown is the only thing on screen, alongside
 * Pause/Resume, Finish, and Cancel; the Timers presets and statistics/history
 * live behind a tap so nothing else competes with the clock (#162). */
export function FocusView({ initialTask = null, onOpenStats }: FocusViewProps): React.JSX.Element {
  // The live run (ticking clock, pause/resume/finish/cancel) is shared with
  // the nav bar badge — this screen just supplies the pre-start
  // configuration and the Timers presets.
  const {
    pomoStreak,
    sessionsRecorded,
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
  const [todayTasks, setTodayTasks] = useState<Task[]>([]);
  const [statDays, setStatDays] = useState<FocusDayTotal[] | null>(null);
  const [timers, setTimers] = useState<Timer[]>([]);
  const [timerEditor, setTimerEditor] = useState<
    { mode: "add" } | { mode: "edit"; id: number } | null
  >(null);
  const cancelNoteId = useId();
  const [customLength, setCustomLength] = useState(false);
  const [editingBreaks, setEditingBreaks] = useState(false);
  const [editingLink, setEditingLink] = useState(false);

  // The Timers read drives the view's loading/empty/error states (#442).
  const [timersStatus, setTimersStatus] = useState<"loading" | "ready" | "error">("loading");

  const loadTimers = useCallback(async (): Promise<void> => {
    setTimers((await fetchTimers()).items);
    setTimersStatus("ready");
  }, []);

  const firstLoadTimers = useCallback((): void => {
    setTimersStatus("loading");
    void loadTimers().catch(() => setTimersStatus("error"));
  }, [loadTimers]);

  useEffect(() => {
    firstLoadTimers();
    void fetchOpenTasks().then((page) => setTasks(page.items));
    const today = localDayOf(new Date());
    void fetchSmartTasks("today", today, { listId: null, tagId: null, priority: null }).then(
      (page) => setTodayTasks(page.items.filter((task) => !task.completed)),
    );
    void fetchHabits().then((page) => setHabits(page.items.filter((habit) => !habit.is_archived)));
  }, [firstLoadTimers]);

  // Last 7 days of totals for the aside; a newly recorded session refreshes them.
  useEffect(() => {
    const today = localDayOf(new Date());
    void loadFocusDays(addDays(today, -6), today).then(setStatDays);
  }, [sessionsRecorded]);

  const paused = running !== null && running.pauseStartedAtMs !== null;
  useRegisterShortcut({
    key: " ",
    label: "Space",
    description: running === null ? "start focus" : paused ? "resume focus" : "pause focus",
    run: () => {
      if (pendingBreak !== null) return;
      if (running === null) start();
      else if (paused) resume();
      else pause();
    },
  });

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
  // Today's Tasks may not all be in the open-Tasks page; look in both.
  const knownTasks = [...tasks, ...todayTasks.filter((t) => !tasks.some((o) => o.id === t.id))];
  const stageTask = running !== null ? linkLabel(running.link, knownTasks, habits) : null;
  const linkedName = linkLabel(link, knownTasks, habits);
  const today = localDayOf(new Date());
  const strip = statDays;
  const mondayOffset = (new Date().getDay() + 6) % 7;
  const weekStart = addDays(today, -mondayOffset);

  // One line above the clock saying which of the five states the stage is
  // in. The dial alone can't say "paused" or "break" — and without it the
  // idle screen and a running one look like the same screen (#162).
  const phaseLabel =
    pendingBreak !== null
      ? "Break up next"
      : running === null
        ? mode === "pomo"
          ? pomoOfCycle(pomoStreak)
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
        {running === null && pendingBreak === null && (
          <div className="focus-headline">
            <button
              className="btn-quiet focus-headline-button"
              type="button"
              aria-expanded={editingLink}
              aria-label={linkedName !== null ? `Linked: ${linkedName}` : undefined}
              onClick={() => setEditingLink(!editingLink)}
            >
              {linkedName ?? "Link Task or Habit"}
            </button>
            {editingLink && (
              <div className="focus-link-popover">
                <Hint hintKey="focus-link">
                  <LinkSelect
                    label="Link"
                    className="focus-field"
                    tasks={knownTasks}
                    habits={habits}
                    value={link}
                    onChange={setLink}
                  />
                </Hint>
                {link !== "" && (
                  <button
                    className="btn-quiet"
                    type="button"
                    onClick={() => {
                      setLink("");
                      setEditingLink(false);
                    }}
                  >
                    Clear link
                  </button>
                )}
              </div>
            )}
          </div>
        )}
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
                <button className="btn-focus" type="button" onClick={startBreak}>
                  {`Start ${pendingBreak.long ? "long break" : "break"}`}
                </button>
                <button type="button" className="focus-secondary" onClick={skipBreak}>
                  Skip
                </button>
              </div>
            </div>
          ) : running === null ? (
            <>
              <div className="focus-setup">
                <div className="focus-mode" role="group" aria-label="Mode">
                  {(["pomo", "stopwatch"] as const).map((value) => (
                    <button
                      className="btn-secondary"
                      type="button"
                      key={value}
                      aria-pressed={mode === value}
                      onClick={() => setMode(value)}
                    >
                      {value === "pomo" ? "Pomo" : "Stopwatch"}
                    </button>
                  ))}
                </div>
                {mode === "pomo" && (
                  <>
                    <div className="focus-presets" role="group" aria-label="Length presets">
                      {[15, 25, 50, 90].map((minutes) => (
                        <button
                          className="btn-secondary"
                          type="button"
                          key={minutes}
                          aria-pressed={!customLength && Number(pomoMinutes) === minutes}
                          onClick={() => {
                            setPomoMinutes(String(minutes));
                            setCustomLength(false);
                          }}
                        >
                          {minutes} min
                        </button>
                      ))}
                      <button
                        className="btn-secondary"
                        type="button"
                        aria-pressed={customLength}
                        onClick={() => setCustomLength(true)}
                      >
                        Custom
                      </button>
                    </div>
                    {customLength && (
                      <label className="focus-field">
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
                  </>
                )}
                {timersStatus === "loading" ? (
                  <SkeletonRows label="Loading timers" count={2} />
                ) : timersStatus === "error" ? (
                  <LoadError what="timers" onRetry={firstLoadTimers} />
                ) : timers.length === 0 && timerEditor === null ? (
                  <EmptyState
                    title="No timers yet"
                    description="A Timer saves a mode, length and link so a session starts in one tap."
                    actionLabel="Add Timer"
                    onAction={() => setTimerEditor({ mode: "add" })}
                  />
                ) : (
                  <>
                    <ul aria-label="Timers" className="focus-timer-presets">
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
                                className="btn-secondary"
                                type="button"
                                aria-label={`Start timer ${timer.name}`}
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
                      <Hint hintKey="add-timer">
                        <button
                          className="btn-secondary"
                          type="button"
                          onClick={() => setTimerEditor({ mode: "add" })}
                        >
                          <Icon name="plus" size={16} />
                          Add Timer
                        </button>
                      </Hint>
                    )}
                  </>
                )}
              </div>
              <div className="focus-actions">
                <button
                  type="button"
                  className="focus-primary btn-focus"
                  onClick={start}
                  disabled={mode === "pomo" && Number(pomoMinutes) < 1}
                >
                  Start
                </button>
              </div>
              {mode === "pomo" && (
                <>
                  <button
                    className="btn-quiet focus-break-settings"
                    type="button"
                    aria-expanded={editingBreaks}
                    onClick={() => setEditingBreaks(!editingBreaks)}
                  >
                    Break {breakMinutes} min · Long break {longBreakMinutes} min
                  </button>
                  {editingBreaks && (
                    <div className="focus-lengths focus-break-editor">
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
                    </div>
                  )}
                </>
              )}
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
                  <button
                    type="button"
                    className="focus-primary btn-focus"
                    // A failed save keeps the run; tapping again retries it.
                    onClick={() => void finish().catch(() => undefined)}
                  >
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
          <section className="focus-today">
            <h3>Today</h3>
            {todayTasks.length === 0 ? (
              <p className="focus-empty">Nothing due today.</p>
            ) : (
              <ul className="focus-today-tasks" aria-label="Today's Tasks">
                {todayTasks.map((task) => (
                  <li key={task.id}>
                    <button
                      type="button"
                      className="focus-today-task"
                      aria-pressed={link === `task:${task.id}`}
                      onClick={() => setLink(`task:${task.id}`)}
                    >
                      {task.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="focus-totals" aria-label="Focus totals">
            <dl>
              <div>
                <dt>Today</dt>
                <dd>{strip === null ? "…" : formatFocusTotal(strip[6]?.seconds ?? 0)}</dd>
              </div>
              <div>
                <dt>This week</dt>
                <dd>
                  {strip === null
                    ? "…"
                    : formatFocusTotal(
                        strip
                          .filter((day) => day.date >= weekStart)
                          .reduce((sum, day) => sum + day.seconds, 0),
                      )}
                </dd>
              </div>
            </dl>
            {strip !== null && (
              <ul className="focus-strip" aria-label="Last 7 days">
                {(() => {
                  const max = Math.max(1, ...strip.map((day) => day.seconds));
                  return strip.map((day) => (
                    <li
                      key={day.date}
                      aria-label={`${shortDayLabel(day.date)}: ${Math.round(day.seconds / 60)} min`}
                      aria-current={day.date === today ? "date" : undefined}
                    >
                      <span
                        className="focus-strip-bar"
                        style={{ height: `${Math.round((day.seconds / max) * 100)}%` }}
                      />
                    </li>
                  ));
                })()}
              </ul>
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
        </aside>
      )}
    </div>
  );
}
