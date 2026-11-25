import { EmptyState, LoadError, SkeletonRows } from "./TaskViewState";
import "./HabitsView.css";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  createHabit,
  createHabitPause,
  deleteHabit,
  fetchCheckIns,
  fetchHabits,
  fetchHabitStats,
  resumeHabitPause,
  skipHabitDay,
  unskipHabitDay,
  updateHabit,
  updateHabitPause,
  type CheckIn,
  type Habit,
  type HabitCreateInput,
  type HabitPauseInput,
  type HabitStats,
} from "../api";
import { addDays, formatDate, fromDayIso, localDayOf, shortDayLabel } from "../dates";
import { habitFrequencyLabel } from "../habitFrequency";
import { tapCheckIn } from "../habitCheckIn";
import { currentOrNextPause, habitDayReader, stripDays, type DayState } from "../habitStats";
import { HabitActionsMenu } from "./HabitActionsMenu";
import { HabitCardStats } from "./HabitCardStats";
import { HabitForm, type HabitFormValues } from "./HabitForm";
import { HabitHistory } from "./HabitHistory";
import { HabitPauseForm, HabitPauseStatus } from "./HabitPause";
import { HabitSkipStatus } from "./HabitSkip";
import { Hint } from "./Hint";
import { Icon } from "./Icon";

type Editor =
  | { mode: "create" }
  | { mode: "edit"; habitId: number }
  | { mode: "pause"; habitId: number }
  | null;

/** The today's-Habits screen: the Habits scheduled today with one-tap
 * Check-ins, plus the rest under "Other habits" for management. Self-fetching,
 * like the CalendarView — check-in state is the server's call, not local
 * bookkeeping's.
 */
export function HabitsView({
  refreshToken = 0,
}: { refreshToken?: number } = {}): React.JSX.Element {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [editor, setEditor] = useState<Editor>(null);
  // The habit whose history (grid + heatmap) is expanded, if any.
  const [historyId, setHistoryId] = useState<number | null>(null);
  // The habit-and-day Check-in writes in flight (see addStep). A ref, not
  // state: a second tap in the same tick would still read the old state and
  // slip through, and nothing here is rendered.
  const pending = useRef<Set<string>>(new Set());
  // Each card's server-computed Streak + heatmap, for the Streak count and
  // recent-days strip — keyed by habit id, absent while still loading.
  const [statsByHabit, setStatsByHabit] = useState<Map<number, HabitStats>>(new Map());
  const today = localDayOf(new Date());

  // "loading" until the first read lands, "error" when it fails (#442): an
  // unloaded view is not an empty one.
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async (): Promise<void> => {
    const [allPage, checkInPage] = await Promise.all([fetchHabits(), fetchCheckIns(today)]);
    setHabits(allPage.items);
    setCheckIns(checkInPage.items);
    setStatus("ready");
    const statsEntries = await Promise.all(
      allPage.items.map(async (habit) => [habit.id, await habitStatsFor(habit, today)] as const),
    );
    setStatsByHabit(new Map(statsEntries));
  }, [today]);

  // `refreshToken` bumps when a Voice Assistant write lands (issue #370): re-read, as ever.
  const loadOrFail = useCallback(async (): Promise<void> => {
    try {
      await load();
    } catch {
      setStatus((current) => (current === "ready" ? current : "error"));
    }
  }, [load]);

  useEffect(() => {
    void loadOrFail();
  }, [loadOrFail, refreshToken]);

  const archived = habits.filter((habit) => habit.is_archived);
  const active = habits.filter((habit) => !habit.is_archived);
  const checkInOf = (habit: Habit): CheckIn | undefined =>
    checkIns.find((checkIn) => checkIn.habit_id === habit.id);

  function applyCheckIn(saved: CheckIn): void {
    setCheckIns((current) => [
      ...current.filter((checkIn) => checkIn.habit_id !== saved.habit_id),
      saved,
    ]);
  }

  /** Re-read one Habit's stats after a Check-in write. The Streak and the
   * recent-days strip are the server's call, so a tap that changes the day's
   * Check-in leaves the numbers on screen stale until they are refetched. */
  const refreshStats = useCallback(
    async (habit: Habit): Promise<void> => {
      const stats = await habitStatsFor(habit, today);
      setStatsByHabit((current) => new Map(current).set(habit.id, stats));
    },
    [today],
  );

  /** What a Habit has recorded on a day. Today is read from the day's
   * Check-in (what the card's own controls show); an earlier day from the
   * card's stats, the strip's own source. */
  function valueOn(habit: Habit, day: string): number {
    if (day === today) {
      return checkInOf(habit)?.value ?? 0;
    }
    const entry = statsByHabit.get(habit.id)?.heatmap.find((day_) => day_.date === day);
    return entry?.value ?? 0;
  }

  /** Runs one Check-in write for a Habit's day, and not a second while it is
   * still in flight — the writes are read-modify-write, so a rapid double-tap
   * would otherwise compute both from the same stale value and lose a step. */
  async function writeDay(habit: Habit, day: string, write: () => Promise<void>): Promise<void> {
    const key = `${habit.id}:${day}`;
    if (pending.current.has(key)) {
      return;
    }
    pending.current.add(key);
    try {
      await write();
      await refreshStats(habit);
    } finally {
      pending.current.delete(key);
    }
  }

  /** A tap on one day of a Habit — the card's check control for today, or a
   * square in the recent-days strip for an earlier one. A Boolean day
   * toggles; a Numeric day accumulates one step, and a tap on a day that
   * already met its Target clears it. Backfilling a missed day is the same
   * gesture as checking today in, so it needs no separate screen. */
  async function toggleDay(habit: Habit, day: string): Promise<void> {
    await writeDay(habit, day, async () => {
      const saved = await tapCheckIn(habit, day, valueOn(habit, day));
      if (day !== today) {
        return;
      }
      if (saved === null) {
        setCheckIns((current) => current.filter((checkIn) => checkIn.habit_id !== habit.id));
      } else {
        applyCheckIn(saved);
      }
    });
  }

  async function handleCreate(values: HabitFormValues): Promise<void> {
    await createHabit(toCreateInput(values));
    setEditor(null);
    await load();
  }

  async function handleEdit(habit: Habit, values: HabitFormValues): Promise<void> {
    const input = toCreateInput(values);
    await updateHabit(habit.id, {
      name: input.name,
      type: input.type,
      target: input.target,
      step: input.step,
      unit: input.unit ?? null,
      icon: input.icon ?? null,
      color: input.color ?? null,
      encouragement: input.encouragement ?? "",
      frequency: input.frequency,
    });
    setEditor(null);
    await load();
  }

  async function setArchived(habit: Habit, isArchived: boolean): Promise<void> {
    await updateHabit(habit.id, { is_archived: isArchived });
    await load();
  }

  /** Saves the pause form: a new pause, or Edit pause on the current one.
   * A refusal (Check-ins in the way) throws back to the form, which keeps
   * the attempted dates and names the conflict. */
  async function savePause(habit: Habit, input: HabitPauseInput): Promise<void> {
    const pause = currentOrNextPause(habit, today);
    if (pause === undefined) {
      await createHabitPause(habit.id, input);
    } else {
      await updateHabitPause(habit.id, pause.id, input);
    }
    setEditor(null);
    await load();
  }

  async function resumeToday(habit: Habit): Promise<void> {
    const pause = currentOrNextPause(habit, today);
    if (pause !== undefined) {
      await resumeHabitPause(habit.id, pause.id, today);
      await load();
    }
  }

  /** Skip today on purpose (issue #564), or undo it. */
  async function setSkippedToday(habit: Habit, skip: boolean): Promise<void> {
    await (skip ? skipHabitDay(habit.id, today) : unskipHabitDay(habit.id, today));
    await load();
  }

  async function handleDelete(habit: Habit): Promise<void> {
    const confirmed = window.confirm(
      `Delete the habit "${habit.name}" and its whole check-in history?`,
    );
    if (!confirmed) {
      return;
    }
    await deleteHabit(habit.id);
    await load();
  }

  function actionsMenu(habit: Habit): React.JSX.Element {
    const todayState = habitDayReader(
      habit,
      statsByHabit.get(habit.id),
      today,
    )(today, valueOn(habit, today)).state;
    return (
      <HabitActionsMenu
        habit={habit}
        onHistory={() => setHistoryId((current) => (current === habit.id ? null : habit.id))}
        onEdit={() => setEditor({ mode: "edit", habitId: habit.id })}
        onPause={
          habit.is_archived || currentOrNextPause(habit, today) !== undefined
            ? null
            : () => setEditor({ mode: "pause", habitId: habit.id })
        }
        onSkipToday={
          habit.is_archived || todayState !== "open-today"
            ? null
            : () => void setSkippedToday(habit, true)
        }
        onToggleArchive={() => void setArchived(habit, !habit.is_archived)}
        onDelete={() => void handleDelete(habit)}
      />
    );
  }

  function editForm(habit: Habit): React.JSX.Element {
    return (
      <HabitForm
        initial={habit}
        onSubmit={(values) => void handleEdit(habit, values)}
        onCancel={() => setEditor(null)}
      />
    );
  }

  function renderRow(habit: Habit): React.JSX.Element[] {
    if (editor?.mode === "edit" && editor.habitId === habit.id) {
      return [
        <tr key={habit.id}>
          <td colSpan={8} className="habit-editing">
            {editForm(habit)}
          </td>
        </tr>,
      ];
    }
    const stats = statsByHabit.get(habit.id);
    // Before the stats land, the reader falls back to the creation day, so a
    // loading grid can't show a miss the server wouldn't. A day before the
    // Habit start stays a button: tapping it is a deliberate backfill.
    const read = habitDayReader(habit, stats, today);
    const rows = [
      <tr key={habit.id} className="habit-row">
        <th scope="row" className="habit-row-head">
          <div className="habit-head">
            {habit.color !== null && (
              <span className="color-dot" style={{ background: habit.color }} />
            )}
            {habit.icon !== null && <span className="habit-icon">{habit.icon}</span>}
            <div className="habit-body">
              <span className="habit-name">{habit.name}</span>
              <Hint hintKey="streak">
                <span className="habit-streak-count" tabIndex={0}>
                  <Icon name="flame" size={12} />
                  Streak: {stats?.streak ?? 0}
                </span>
              </Hint>
            </div>
            {actionsMenu(habit)}
          </div>
        </th>
        {weekDays.map((day) => {
          const value = valueOn(habit, day);
          const { state, level, text } = read(day, value);
          const label = `${habit.name}, ${weekdayLongLabel(day)}: ${text}`;
          const className = `habit-cell state-${state} heatmap-day level-${level}${state === "not-started" ? " not-started" : ""}${day === today ? " today" : ""}`;
          return (
            <td key={day}>
              {state === "future" || state === "paused" || state === "skipped" ? (
                // Inert: a future day can't be written yet, and a paused or
                // skipped day refuses a Check-in until it is changed.
                <span role="img" className={className} aria-label={label}>
                  {state === "paused" && <Icon name="pause" size={12} />}
                  {state === "skipped" && <Icon name="skip-forward" size={12} />}
                </span>
              ) : (
                <button
                  type="button"
                  className={className}
                  aria-label={label}
                  aria-pressed={value > 0}
                  onClick={() => void toggleDay(habit, day)}
                >
                  {state === "done" && <Icon name="check" size={12} />}
                  {state === "open-today" && (
                    // Today's open cell says what it is and what a tap does,
                    // on screen: the name alone is only heard.
                    <span className="habit-cell-today-text">
                      <span>Not yet</span>
                      <span className="habit-cell-today-action">Check in</span>
                    </span>
                  )}
                  {state === "partial" && (
                    <span className="habit-cell-progress">
                      {value}/{habit.target}
                    </span>
                  )}
                </button>
              )}
            </td>
          );
        })}
      </tr>,
    ];
    const pause = currentOrNextPause(habit, today);
    if (editor?.mode === "pause" && editor.habitId === habit.id) {
      rows.push(
        <tr key={`${habit.id}-pause`}>
          <td colSpan={8}>
            <HabitPauseForm
              label={pause === undefined ? `Pause ${habit.name}` : `Edit pause for ${habit.name}`}
              initial={pause}
              today={today}
              onSave={(input) => savePause(habit, input)}
              onCancel={() => setEditor(null)}
            />
          </td>
        </tr>,
      );
    } else if (pause !== undefined) {
      rows.push(
        <tr key={`${habit.id}-pause`}>
          <td colSpan={8}>
            <HabitPauseStatus
              habitName={habit.name}
              pause={pause}
              today={today}
              onEdit={() => setEditor({ mode: "pause", habitId: habit.id })}
              onResume={() => void resumeToday(habit)}
            />
          </td>
        </tr>,
      );
    }
    if (read(today, valueOn(habit, today)).state === "skipped") {
      rows.push(
        <tr key={`${habit.id}-skip`}>
          <td colSpan={8}>
            <HabitSkipStatus
              habitName={habit.name}
              onUndo={() => void setSkippedToday(habit, false)}
            />
          </td>
        </tr>,
      );
    }
    if (historyId === habit.id) {
      rows.push(
        <tr key={`${habit.id}-history`}>
          <td colSpan={8}>
            <HabitHistory habit={habit} onChanged={() => void load()} />
          </td>
        </tr>,
      );
    }
    return rows;
  }

  function renderArchived(habit: Habit): React.JSX.Element {
    if (editor?.mode === "edit" && editor.habitId === habit.id) {
      return (
        <li key={habit.id} className="habit-editing">
          {editForm(habit)}
        </li>
      );
    }
    return (
      <li key={habit.id} className="habit">
        <div className="habit-head">
          {habit.icon !== null && <span className="habit-icon">{habit.icon}</span>}
          <div className="habit-body">
            <h3>{habit.name}</h3>
            <p className="habit-frequency">{habitFrequencyLabel(habit.frequency)}</p>
          </div>
          {actionsMenu(habit)}
        </div>
        <HabitCardStats
          habit={habit}
          stats={statsByHabit.get(habit.id)}
          today={today}
          onToggleDay={null}
          showStreak={false}
        />
        {historyId === habit.id && <HabitHistory habit={habit} onChanged={() => void load()} />}
      </li>
    );
  }

  const weekStart = addDays(today, -((fromDayIso(today).getDay() + 6) % 7));
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  if (status === "loading") {
    return (
      <div className="habits-view">
        <SkeletonRows label="Loading habits" />
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="habits-view">
        <LoadError
          what="habits"
          onRetry={() => {
            setStatus("loading");
            void loadOrFail();
          }}
        />
      </div>
    );
  }

  const empty = habits.length === 0 && editor === null;

  return (
    <div className="habits-view">
      {habits.length === 0
        ? empty && (
            <EmptyState
              title="No habits yet"
              description="Habits are things you check in on daily or weekly — add one to start tracking it."
              actionLabel="Add Habit"
              onAction={() => setEditor({ mode: "create" })}
            />
          )
        : active.length > 0 && (
            <>
              <div className="habits-week-scroll">
                <table className="habits-week-grid" aria-label="Habits this week">
                  <thead>
                    <tr>
                      <th scope="col" className="habits-week-corner">
                        Habit
                      </th>
                      {weekDays.map((day) => (
                        <th
                          key={day}
                          scope="col"
                          aria-label={`${day === today ? "Today, " : ""}${weekdayLongLabel(day)}`}
                          className={day === today ? "week-day today" : "week-day"}
                        >
                          <span aria-hidden="true">
                            {formatDate(fromDayIso(day), "weekday")}
                            <span className="week-day-num">{day.slice(8).replace(/^0/, "")}</span>
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>{active.flatMap((habit) => renderRow(habit))}</tbody>
                </table>
              </div>
              <section className="habits-long-history" aria-label="Recent days">
                {active.map((habit) => (
                  <div key={habit.id} className="habit-long-history-row">
                    <span className="habit-name">{habit.name}</span>
                    <HabitCardStats
                      habit={habit}
                      stats={statsByHabit.get(habit.id)}
                      today={today}
                      onToggleDay={(day) => void toggleDay(habit, day)}
                      showStreak={false}
                    />
                  </div>
                ))}
              </section>
            </>
          )}
      {habits.length > 0 && <DayLegend />}
      {archived.length > 0 && (
        <section className="archived-habits">
          <h2>Archived</h2>
          <ul className="habits-grid" aria-label="Archived habits">
            {archived.map((habit) => renderArchived(habit))}
          </ul>
        </section>
      )}
      {editor?.mode === "create" ? (
        <HabitForm
          onSubmit={(values) => void handleCreate(values)}
          onCancel={() => setEditor(null)}
        />
      ) : (
        !empty && (
          <button
            className="btn-secondary"
            type="button"
            onClick={() => setEditor({ mode: "create" })}
          >
            Add Habit
          </button>
        )
      )}
    </div>
  );
}

/** What each day square means, in words that are always on screen: the
 * cells' own names are only heard, and the strip's hint needs a hover. */
const LEGEND: { state: DayState; level: number; text: string }[] = [
  { state: "done", level: 4, text: "Checked in" },
  { state: "partial", level: 2, text: "In progress" },
  { state: "open-today", level: 0, text: "Not yet: today, still open" },
  { state: "missed", level: 0, text: "Missed" },
  { state: "not-started", level: 0, text: "Not started: before the Habit began" },
  { state: "not-scheduled", level: 0, text: "Not scheduled" },
  { state: "paused", level: 0, text: "Paused: not counted, neither done nor missed" },
  {
    state: "skipped",
    level: 0,
    text: "Skipped: on purpose, not counted, neither done nor missed",
  },
  { state: "future", level: 0, text: "Future" },
];

function DayLegend(): React.JSX.Element {
  return (
    <ul className="habits-legend" aria-label="What the days mean">
      {LEGEND.map(({ state, level, text }) => (
        <li key={state}>
          <span
            aria-hidden="true"
            className={`habit-cell habits-legend-swatch state-${state} heatmap-day level-${level}${state === "not-started" ? " not-started" : ""}`}
          >
            {state === "done" && <Icon name="check" size={14} />}
            {state === "paused" && <Icon name="pause" size={12} />}
            {state === "skipped" && <Icon name="skip-forward" size={12} />}
          </span>
          {text}
        </li>
      ))}
    </ul>
  );
}

/** "Friday, Jul 3" — a week-grid column's spoken day. */
function weekdayLongLabel(day: string): string {
  return `${formatDate(fromDayIso(day), "weekdayLong")}, ${shortDayLabel(day)}`;
}

/** One Habit's stats, covering every day its card's strip shows. The
 * server's heatmap is one calendar year at a time, and in early January the
 * strip still reaches back into last December — so at a year boundary this
 * asks for both years and merges them. Otherwise those days would read as
 * missed however faithfully they were checked in, and a tap meaning "undo"
 * would check them in again. */
async function habitStatsFor(habit: Habit, today: string): Promise<HabitStats> {
  const years = [...new Set(stripDays(habit.frequency, today).map((day) => day.slice(0, 4)))];
  const pages = await Promise.all(
    years.map(async (year) => fetchHabitStats(habit.id, today, Number(year))),
  );
  // The Streak and the Habit start are as of `today` whichever year was
  // asked for, so any page's will do; the heatmaps are disjoint years, so
  // they simply concatenate.
  return {
    streak: pages[0]?.streak ?? 0,
    heatmap: pages.flatMap((page) => page.heatmap),
    eligible_from: pages[0]?.eligible_from ?? today,
  };
}

/** The API payload a form submission builds: Boolean habits must not carry
 * target fields, and blank optional strings mean "unset". */
function toCreateInput(values: HabitFormValues): HabitCreateInput {
  return {
    name: values.name,
    type: values.type,
    ...(values.type === "numeric"
      ? {
          target: values.target,
          step: values.step,
          ...(values.unit === "" ? {} : { unit: values.unit }),
        }
      : {}),
    ...(values.icon === "" ? {} : { icon: values.icon }),
    ...(values.color === "" ? {} : { color: values.color }),
    encouragement: values.encouragement,
    frequency: values.frequency,
  };
}
