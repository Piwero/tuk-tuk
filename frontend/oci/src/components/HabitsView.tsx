import { useCallback, useEffect, useState } from "react";

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
import { HabitActionsMenu } from "./HabitActionsMenu";
import { HabitCardStats } from "./HabitCardStats";
import { HabitForm, type HabitFormValues } from "./HabitForm";
import { HabitHistory } from "./HabitHistory";
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
  // Habits with a check-in write in flight (see addStep).
  const [pending, setPending] = useState<Set<number>>(new Set());
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
      allPage.items.map(
        async (habit) => [habit.id, await fetchHabitStats(habit.id, today)] as const,
      ),
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
    async (habitId: number): Promise<void> => {
      const stats = await fetchHabitStats(habitId, today);
      setStatsByHabit((current) => new Map(current).set(habitId, stats));
    },
    [today],
  );

  /** A Boolean tap checks the day in; tapping again undoes it. */
  async function toggleCheckIn(habit: Habit): Promise<void> {
    const existing = checkInOf(habit);
    if (existing === undefined) {
      applyCheckIn(await putCheckIn(habit.id, today, 1));
    } else {
      await removeCheckIn(habit.id, today);
      setCheckIns((current) => current.filter((checkIn) => checkIn.habit_id !== habit.id));
    }
    await refreshStats(habit.id);
  }

  /** A Numeric tap accumulates one step into the day's Check-in. The tap's
   * read-modify-write settles before the next is allowed (`pending`), so a
   * rapid double-tap can't overwrite itself and lose a step. */
  async function addStep(habit: Habit): Promise<void> {
    if (pending.has(habit.id)) {
      return;
    }
    setPending((current) => new Set(current).add(habit.id));
    try {
      const value = (checkInOf(habit)?.value ?? 0) + habit.step;
      applyCheckIn(await putCheckIn(habit.id, today, value));
      await refreshStats(habit.id);
    } finally {
      setPending((current) => {
        const next = new Set(current);
        next.delete(habit.id);
        return next;
      });
    }
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
          <HabitCardStats habit={habit} stats={statsByHabit.get(habit.id)} today={today} />
        )}
        {showCheckInControls && (
          <div className="habit-checkin">
            {habit.type === "boolean" ? (
              <button
                type="button"
                className="habit-check"
                aria-label={complete ? `Undo check-in ${habit.name}` : `Check in ${habit.name}`}
                aria-pressed={complete}
                onClick={() => void toggleCheckIn(habit)}
              >
                {complete && <Icon name="check" size={18} />}
              </button>
            ) : (
              <>
                <span className="habit-progress">
                  {value} / {habit.target}
                  {habit.unit === null ? "" : ` ${habit.unit}`}
                  {complete && <span className="habit-done"> — Done</span>}
                </span>
                <button
                  type="button"
                  className="habit-step"
                  aria-label={`Add ${habit.step} to ${habit.name}`}
                  onClick={() => void addStep(habit)}
                >
                  +{habit.step}
                </button>
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
