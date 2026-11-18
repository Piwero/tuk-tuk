import "./HabitsView.css";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  createHabit,
  deleteHabit,
  fetchCheckIns,
  fetchHabits,
  fetchHabitStats,
  putCheckIn,
  removeCheckIn,
  updateHabit,
  type CheckIn,
  type Habit,
  type HabitCreateInput,
  type HabitStats,
} from "../api";
import { addDays, formatDate, fromDayIso, localDayOf, shortDayLabel } from "../dates";
import { habitDueOn, habitFrequencyLabel } from "../habitFrequency";
import { heatLevel, nextCheckIn, stripDays } from "../habitStats";
import { HabitActionsMenu } from "./HabitActionsMenu";
import { HabitCardStats } from "./HabitCardStats";
import { HabitForm, type HabitFormValues } from "./HabitForm";
import { HabitHistory } from "./HabitHistory";
import { Hint } from "./Hint";
import { Icon } from "./Icon";

type Editor = { mode: "create" } | { mode: "edit"; habitId: number } | null;

/** The today's-Habits screen: the Habits scheduled today with one-tap
 * Check-ins, plus the rest under "Other habits" for management. Self-fetching,
 * like the CalendarView — check-in state is the server's call, not local
 * bookkeeping's.
 */
export function HabitsView({ refreshToken = 0 }: { refreshToken?: number } = {}): JSX.Element {
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

  const load = useCallback(async (): Promise<void> => {
    const [allPage, checkInPage] = await Promise.all([fetchHabits(), fetchCheckIns(today)]);
    setHabits(allPage.items);
    setCheckIns(checkInPage.items);
    const statsEntries = await Promise.all(
      allPage.items.map(async (habit) => [habit.id, await habitStatsFor(habit, today)] as const),
    );
    setStatsByHabit(new Map(statsEntries));
  }, [today]);

  // `refreshToken` bumps when a Voice Assistant write lands (issue #370): re-read, as ever.
  useEffect(() => {
    void load();
  }, [load, refreshToken]);

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
      const next = nextCheckIn(habit, valueOn(habit, day));
      if (next.clear) {
        await removeCheckIn(habit.id, day);
        if (day === today) {
          setCheckIns((current) => current.filter((checkIn) => checkIn.habit_id !== habit.id));
        }
        return;
      }
      const saved = await putCheckIn(habit.id, day, next.value);
      if (day === today) {
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

  /** The week-grid cell for one Habit's day: its state, fill level and
   * the words a screen reader hears. Partial Numeric days take a lighter
   * step of the heat ramp than a met Target. */
  function cellState(habit: Habit, day: string): { state: CellState; level: number; text: string } {
    const value = valueOn(habit, day);
    if (value >= habit.target) {
      return { state: "done", level: 4, text: "checked in" };
    }
    if (value > 0) {
      const unit = habit.unit === null ? "" : ` ${habit.unit}`;
      return {
        state: "partial",
        level: Math.min(3, Math.max(1, heatLevel(value / habit.target))),
        text: `in progress: ${value} of ${habit.target}${unit}`,
      };
    }
    if (day > today) {
      return { state: "future", level: 0, text: "future" };
    }
    if (!habitDueOn(habit.frequency, day)) {
      return { state: "not-scheduled", level: 0, text: "not scheduled" };
    }
    return day === today
      ? { state: "open-today", level: 0, text: "not yet checked in" }
      : { state: "missed", level: 0, text: "missed" };
  }

  function actionsMenu(habit: Habit): JSX.Element {
    return (
      <HabitActionsMenu
        habit={habit}
        onHistory={() => setHistoryId((current) => (current === habit.id ? null : habit.id))}
        onEdit={() => setEditor({ mode: "edit", habitId: habit.id })}
        onToggleArchive={() => void setArchived(habit, !habit.is_archived)}
        onDelete={() => void handleDelete(habit)}
      />
    );
  }

  function editForm(habit: Habit): JSX.Element {
    return (
      <HabitForm
        initial={habit}
        onSubmit={(values) => void handleEdit(habit, values)}
        onCancel={() => setEditor(null)}
      />
    );
  }

  function renderRow(habit: Habit): JSX.Element[] {
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
          const { state, level, text } = cellState(habit, day);
          const label = `${habit.name}, ${weekdayLongLabel(day)}: ${text}`;
          const className = `habit-cell state-${state} heatmap-day level-${level}${day === today ? " today" : ""}`;
          const value = valueOn(habit, day);
          return (
            <td key={day}>
              {state === "future" ? (
                <span role="img" className={className} aria-label={label} />
              ) : (
                <button
                  type="button"
                  className={className}
                  aria-label={label}
                  aria-pressed={value > 0}
                  onClick={() => void toggleDay(habit, day)}
                >
                  {state === "done" && <Icon name="check" size={12} />}
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

  function renderArchived(habit: Habit): JSX.Element {
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

  return (
    <div className="habits-view">
      {habits.length === 0 ? (
        <p className="habits-empty-hint">
          Habits are things you check in on daily or weekly — add one below to start tracking it.
        </p>
      ) : (
        active.length > 0 && (
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
        )
      )}
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
        <button
          className="btn-secondary"
          type="button"
          onClick={() => setEditor({ mode: "create" })}
        >
          Add Habit
        </button>
      )}
    </div>
  );
}

type CellState = "done" | "partial" | "open-today" | "missed" | "not-scheduled" | "future";

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
  // The Streak is as of `today` whichever year was asked for, so any page's
  // will do; the heatmaps are disjoint years, so they simply concatenate.
  return {
    streak: pages[0]?.streak ?? 0,
    heatmap: pages.flatMap((page) => page.heatmap),
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
