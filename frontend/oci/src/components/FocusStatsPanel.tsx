import { useCallback, useEffect, useState } from "react";

import {
  createFocusSession,
  deleteFocusSession,
  fetchFocusSessions,
  fetchFocusStats,
  fetchHabits,
  fetchOpenTasks,
  updateFocusSession,
  type FocusSession,
  type FocusStats,
  type Habit,
  type Task,
} from "../api";
import { addDays, browserTimeZone, localDayOf, shortDayLabel } from "../dates";
import { linkFields } from "../focusLink";
import { FocusSessionForm, type FocusSessionFormValues } from "./FocusSessionForm";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";

const minutes = (seconds: number): string => `${Math.round(seconds / 60)} min`;

interface ChartRow {
  key: string | number;
  label: string;
  seconds: number;
}

/** A single-series horizontal bar chart: one calm hue (the Focus plum), the
 * longest bar always full width, and every bar directly labeled with its own
 * value — small, sparse datasets don't need a hover-only tooltip to be read.
 * Each row also carries its label + value as one accessible name, so a
 * screen reader gets the same "date: N min" reading the old text dump gave. */
function BarChart({
  rows,
  emptyMessage,
  ariaLabel,
}: {
  rows: ChartRow[];
  emptyMessage: string;
  ariaLabel: string;
}): JSX.Element {
  if (rows.length === 0) {
    return <p className="focus-chart-empty">{emptyMessage}</p>;
  }
  const max = Math.max(...rows.map((row) => row.seconds), 1);
  return (
    <ul className="focus-chart" aria-label={ariaLabel}>
      {rows.map((row) => (
        <li
          key={row.key}
          className="focus-chart-row"
          aria-label={`${row.label}: ${minutes(row.seconds)}`}
        >
          <span className="focus-chart-label">{row.label}</span>
          <span className="focus-chart-track">
            <span
              className="focus-chart-bar"
              style={{ width: `${Math.max(2, Math.round((row.seconds / max) * 100))}%` }}
            />
          </span>
          <span className="focus-chart-value">{minutes(row.seconds)}</span>
        </li>
      ))}
    </ul>
  );
}

interface FocusStatsViewProps {
  /** Returns to the (distraction-free) timer screen — its own route. */
  onBack: () => void;
}

/** The Focus statistics + history screen: totals by day and Monday-started
 * week, and per-Task / per-Habit breakdowns over a selectable inclusive day
 * range (the last 7 days by default), each rendered as a chart with its own
 * empty state — plus the full session history, where a past session can be
 * added retroactively, edited, or deleted (#162). Split out from the Focus
 * timer screen so the running clock never has to share space with this. */
export function FocusStatsView({ onBack }: FocusStatsViewProps): JSX.Element {
  const today = localDayOf(new Date());
  const [start, setStart] = useState(addDays(today, -6));
  const [end, setEnd] = useState(today);
  const [stats, setStats] = useState<FocusStats | null>(null);
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [editor, setEditor] = useState<{ mode: "add" } | { mode: "edit"; id: number } | null>(null);

  const loadStats = useCallback(async (): Promise<void> => {
    if (start === "" || end === "" || start > end) {
      return;
    }
    setStats(await fetchFocusStats(start, end, browserTimeZone()));
  }, [start, end]);

  const loadSessions = useCallback(async (): Promise<void> => {
    setSessions((await fetchFocusSessions()).items);
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    void loadSessions();
    void fetchOpenTasks().then((page) => setTasks(page.items));
    void fetchHabits().then((page) => setHabits(page.items.filter((habit) => !habit.is_archived)));
  }, [loadSessions]);

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
    await Promise.all([loadSessions(), loadStats()]);
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
    await Promise.all([loadSessions(), loadStats()]);
  }

  async function handleDelete(session: FocusSession): Promise<void> {
    await deleteFocusSession(session.id);
    await Promise.all([loadSessions(), loadStats()]);
  }

  return (
    <div className="focus-stats-view">
      <button type="button" className="focus-back-link" onClick={onBack}>
        <Icon name="chevron-left" size={16} />
        Back to timer
      </button>
      <section className="focus-stats">
        <h2>Statistics</h2>
        <div className="focus-stats-range">
          <label>
            From
            <input
              type="date"
              aria-label="From"
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              aria-label="To"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          </label>
        </div>
        <h3>By day</h3>
        <BarChart
          ariaLabel="Daily focus"
          rows={(stats?.days ?? []).map((day) => ({
            key: day.date,
            label: shortDayLabel(day.date),
            seconds: day.seconds,
          }))}
          emptyMessage="No focus time recorded in this range yet."
        />
        <h3>By week</h3>
        <BarChart
          ariaLabel="Weekly focus"
          rows={(stats?.weeks ?? []).map((week) => ({
            key: week.start,
            label: `Week of ${shortDayLabel(week.start)}`,
            seconds: week.seconds,
          }))}
          emptyMessage="No full week of focus time recorded in this range yet."
        />
        <h3>By Task</h3>
        <BarChart
          ariaLabel="Focus by Task"
          rows={(stats?.tasks ?? []).map((row) => ({
            key: row.task_id,
            label: row.title,
            seconds: row.seconds,
          }))}
          emptyMessage="No focus time linked to a Task in this range yet."
        />
        <h3>By Habit</h3>
        <BarChart
          ariaLabel="Focus by Habit"
          rows={(stats?.habits ?? []).map((row) => ({
            key: row.habit_id,
            label: row.name,
            seconds: row.seconds,
          }))}
          emptyMessage="No focus time linked to a Habit in this range yet."
        />
      </section>
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
                  <IconButton
                    icon="pencil"
                    label="Edit session"
                    onClick={() => setEditor({ mode: "edit", id: session.id })}
                  />
                  <IconButton
                    icon="x"
                    label="Delete session"
                    onClick={() => void handleDelete(session)}
                  />
                </span>
              </li>
            );
          })}
        </ul>
        {sessions.length === 0 && editor === null && (
          <p className="focus-history-empty">No Focus Sessions recorded yet.</p>
        )}
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
