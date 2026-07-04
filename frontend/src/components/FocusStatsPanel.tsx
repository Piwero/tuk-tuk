import { useCallback, useEffect, useState } from "react";

import { fetchFocusStats, type FocusStats } from "../api";
import { addDays, browserTimeZone, localDayOf } from "../dates";

const minutes = (seconds: number): string => `${Math.round(seconds / 60)} min`;

/** The focus statistics panel: totals by day and Monday-started week, and
 * per-Task / per-Habit breakdowns over a selectable inclusive day range
 * (the last 7 days by default). All numbers come from GET /focus-stats —
 * computed server-side, never locally. */
export function FocusStatsPanel(): JSX.Element {
  const today = localDayOf(new Date());
  const [start, setStart] = useState(addDays(today, -6));
  const [end, setEnd] = useState(today);
  const [stats, setStats] = useState<FocusStats | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (start === "" || end === "" || start > end) {
      return;
    }
    setStats(await fetchFocusStats(start, end, browserTimeZone()));
  }, [start, end]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
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
      <ul aria-label="Daily focus">
        {(stats?.days ?? []).map((day) => (
          <li key={day.date}>
            {day.date}: {minutes(day.seconds)}
          </li>
        ))}
      </ul>
      <h3>By week</h3>
      <ul aria-label="Weekly focus">
        {(stats?.weeks ?? []).map((week) => (
          <li key={week.start}>
            Week of {week.start}: {minutes(week.seconds)}
          </li>
        ))}
      </ul>
      <h3>By Task</h3>
      <ul aria-label="Focus by Task">
        {(stats?.tasks ?? []).map((row) => (
          <li key={row.task_id}>
            {row.title}: {minutes(row.seconds)}
          </li>
        ))}
      </ul>
      <h3>By Habit</h3>
      <ul aria-label="Focus by Habit">
        {(stats?.habits ?? []).map((row) => (
          <li key={row.habit_id}>
            {row.name}: {minutes(row.seconds)}
          </li>
        ))}
      </ul>
    </section>
  );
}
