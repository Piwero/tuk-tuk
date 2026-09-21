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
import { localDayOf } from "../dates";
import { habitFrequencyLabel } from "../habitFrequency";
import { nextCheckIn, stripDays } from "../habitStats";
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
export function HabitsView(): JSX.Element {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [dueIds, setDueIds] = useState<Set<number>>(new Set());
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
    const [duePage, allPage, checkInPage] = await Promise.all([
      fetchHabits(today),
      fetchHabits(),
      fetchCheckIns(today),
    ]);
    setDueIds(new Set(duePage.items.map((habit) => habit.id)));
    setHabits(allPage.items);
    setCheckIns(checkInPage.items);
    const statsEntries = await Promise.all(
      allPage.items.map(async (habit) => [habit.id, await habitStatsFor(habit, today)] as const),
    );
    setStatsByHabit(new Map(statsEntries));
  }, [today]);

  useEffect(() => {
    void load();
  }, [load]);

  const dueToday = habits.filter((habit) => dueIds.has(habit.id));
  const others = habits.filter((habit) => !dueIds.has(habit.id) && !habit.is_archived);
  const archived = habits.filter((habit) => habit.is_archived);
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

  /** The Numeric card's "+step" control: it only ever adds, whatever its
   * label promises — clearing a met Target is the strip's job, not this
   * button's. */
  async function addStep(habit: Habit): Promise<void> {
    await writeDay(habit, today, async () => {
      applyCheckIn(await putCheckIn(habit.id, today, valueOn(habit, today) + habit.step));
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

  function renderHabit(habit: Habit, showCheckInControls: boolean): JSX.Element {
    if (editor?.mode === "edit" && editor.habitId === habit.id) {
      return (
        <li key={habit.id} className="habit-editing">
          <HabitForm
            initial={habit}
            onSubmit={(values) => void handleEdit(habit, values)}
            onCancel={() => setEditor(null)}
          />
        </li>
      );
    }
    const checkIn = checkInOf(habit);
    const value = checkIn?.value ?? 0;
    const complete = value >= habit.target;
    const targetMet = complete && showCheckInControls;
    return (
      <li key={habit.id} className={targetMet ? "habit complete" : "habit"}>
        <div className="habit-head">
          {habit.color !== null && (
            <span className="color-dot" style={{ background: habit.color }} />
          )}
          {habit.icon !== null && <span className="habit-icon">{habit.icon}</span>}
          <div className="habit-body">
            <h3>{habit.name}</h3>
            {habit.encouragement !== "" && (
              <p className="habit-encouragement">{habit.encouragement}</p>
            )}
            <p className="habit-frequency">{habitFrequencyLabel(habit.frequency)}</p>
          </div>
          <HabitActionsMenu
            habit={habit}
            onHistory={() => setHistoryId((current) => (current === habit.id ? null : habit.id))}
            onEdit={() => setEditor({ mode: "edit", habitId: habit.id })}
            onToggleArchive={() => void setArchived(habit, !habit.is_archived)}
            onDelete={() => void handleDelete(habit)}
          />
        </div>
        {/* A met Target is called out in words and with a mark, not by the
         * card's green wash alone. */}
        {targetMet && (
          <p className="habit-target-met">
            <Icon name="check" size={14} />
            Target met
          </p>
        )}
        {/* The expanded history panel already shows the Streak (plus the
         * full grid and heatmap); skip the compact badge so it isn't
         * repeated. */}
        {historyId !== habit.id && (
          <HabitCardStats
            habit={habit}
            stats={statsByHabit.get(habit.id)}
            today={today}
            onToggleDay={habit.is_archived ? null : (day) => void toggleDay(habit, day)}
          />
        )}
        {showCheckInControls && (
          <div className="habit-checkin">
            {habit.type === "boolean" ? (
              <Hint hintKey="habit-checkin">
                <button
                  type="button"
                  className="habit-check"
                  aria-label={complete ? `Undo check-in ${habit.name}` : `Check in ${habit.name}`}
                  aria-pressed={complete}
                  onClick={() => void toggleDay(habit, today)}
                >
                  {complete && <Icon name="check" size={18} />}
                </button>
              </Hint>
            ) : (
              <>
                <Hint hintKey="target">
                  <span className="habit-progress" tabIndex={0}>
                    {value} / {habit.target}
                    {habit.unit === null ? "" : ` ${habit.unit}`}
                    {complete && <span className="habit-done"> — Done</span>}
                  </span>
                </Hint>
                <Hint hintKey="habit-step">
                  <button
                    type="button"
                    className="habit-step"
                    aria-label={`Add ${habit.step} to ${habit.name}`}
                    onClick={() => void addStep(habit)}
                  >
                    +{habit.step}
                  </button>
                </Hint>
              </>
            )}
          </div>
        )}
        {historyId === habit.id && <HabitHistory habit={habit} onChanged={() => void load()} />}
      </li>
    );
  }

  return (
    <div className="habits-view">
      {habits.length === 0 ? (
        <p className="habits-empty-hint">
          Habits are things you check in on daily or weekly — add one below to start tracking it.
        </p>
      ) : (
        <ul className="habits-grid" aria-label="Today's Habits">
          {dueToday.map((habit) => renderHabit(habit, true))}
        </ul>
      )}
      {others.length > 0 && (
        <section className="other-habits">
          <h2>Other habits</h2>
          <ul className="habits-grid" aria-label="Other habits">
            {others.map((habit) => renderHabit(habit, false))}
          </ul>
        </section>
      )}
      {archived.length > 0 && (
        <section className="archived-habits">
          <h2>Archived</h2>
          <ul className="habits-grid" aria-label="Archived habits">
            {archived.map((habit) => renderHabit(habit, false))}
          </ul>
        </section>
      )}
      {editor?.mode === "create" ? (
        <HabitForm
          onSubmit={(values) => void handleCreate(values)}
          onCancel={() => setEditor(null)}
        />
      ) : (
        <button type="button" onClick={() => setEditor({ mode: "create" })}>
          Add Habit
        </button>
      )}
    </div>
  );
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
