import "./CapacitySummary.css";

import { useEffect, useMemo, useState } from "react";

import {
  fetchOpenTasks,
  fetchPlanningWindowSettings,
  type Event,
  type PlanningWindowSettings,
  type Task,
} from "../api";
import { capacityOf } from "../capacity";

interface CapacitySummaryProps {
  /** The local day shown, YYYY-MM-DD. */
  day: string;
  /** The Calendar's Events for the visible range. */
  events: readonly Event[];
  /** The Calendar's open Tasks for the day: those without Planned work are
   * the unknown estimates. */
  dayTasks: readonly Task[];
}

/** Capacity in the User's planning window (issue #563), as a few sentences
 * of text. Hidden while the planning window is off.
 *
 * Planned work is read from every open Task, not from the Calendar's own
 * range query, so a block planned today for a Task due another day still
 * counts, whatever the grid draws. */
export function CapacitySummary({
  day,
  events,
  dayTasks,
}: CapacitySummaryProps): React.JSX.Element | null {
  const [planningWindow, setPlanningWindow] = useState<PlanningWindowSettings | null>(null);
  const [openTasks, setOpenTasks] = useState<Task[]>([]);

  useEffect(() => {
    void fetchPlanningWindowSettings()
      .then(setPlanningWindow)
      .catch(() => setPlanningWindow(null));
  }, []);

  const enabled = planningWindow?.enabled === true;
  useEffect(() => {
    if (!enabled) return;
    void fetchOpenTasks()
      .then((page) => setOpenTasks(page.items))
      .catch(() => setOpenTasks([]));
  }, [enabled, day, dayTasks]);

  const capacity = useMemo(() => {
    if (planningWindow === null || !planningWindow.enabled) return null;
    const byId = new Map<number, Task>();
    for (const task of [...openTasks, ...dayTasks]) byId.set(task.id, task);
    return capacityOf({
      day,
      window: planningWindow,
      events,
      plannedTasks: [...byId.values()],
      dayTasks,
    });
  }, [planningWindow, openTasks, dayTasks, events, day]);

  if (capacity === null) return null;
  return (
    // Polite: a moved plan or a new Event rewrites the sentences in place,
    // and a screen reader hears the new totals without losing its place.
    <section className="capacity-summary" aria-label="Capacity" aria-live="polite">
      {capacity.lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </section>
  );
}
