import "./DateRow.css";
import { useEffect, useState } from "react";

import { updateTask, type Task } from "../api";
import {
  clearedSchedule,
  draftFrom,
  formatSchedule,
  isOverdue,
  rescheduledToDay,
  scheduleFromDraft,
  type DateDraft,
} from "../dates";
import { DatePanel } from "./DatePopover";
import { PropertyRow } from "./PropertyRow";

interface DateRowProps {
  task: Task;
  onTaskChanged: (task: Task) => void;
}

/** Task detail's Due date row (#453; labelled "Due date" since #558, to
 * read apart from Planned work): reads relatively ("Today, 10:00–11:30")
 * and edits through the shared date panel — quick picks, a calendar, a
 * start/end time and Clear. Picking a day keeps a timed Task's times. */
export function DateRow({ task, onTaskChanged }: DateRowProps): React.JSX.Element {
  const [times, setTimes] = useState(() => timesOf(task));

  useEffect(() => {
    setTimes(timesOf(task));
    // Resync only when the saved schedule changes, not mid-typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, task.start_date, task.due_date, task.is_all_day]);

  const draft = draftFrom(task);
  const label = formatSchedule(task, "detail");

  async function save(patch: Parameters<typeof updateTask>[1]): Promise<void> {
    onTaskChanged(await updateTask(task.id, patch));
  }

  function pick(day: string, close: () => void): void {
    close();
    void save(day === "" ? clearedSchedule() : rescheduledToDay(task, day));
  }

  function changeTime(next: { startTime: string; dueTime: string }): void {
    setTimes(next);
    // Save once the times describe a schedule; a lone start waits for its end.
    if (next.dueTime === "" && next.startTime !== "") return;
    const timed: DateDraft = { ...draft, allDay: false, startDay: "", ...next };
    const patch = scheduleFromDraft(timed);
    if (patch !== null) void save(patch);
  }

  return (
    <div className={isOverdue(task) ? "date-row overdue" : "date-row"}>
      <PropertyRow label="Due date" quiet={label === null} value={label ?? "No date"}>
        {(close) => (
          <DatePanel
            value={task.due_date === null ? "" : draft.dueDay}
            clearable={task.due_date !== null}
            nextWeekLabel="Next week"
            onPick={(day) => pick(day, close)}
          >
            <div className="date-row-times">
              <label>
                Start time
                <input
                  type="time"
                  value={times.startTime}
                  onChange={(event) => changeTime({ ...times, startTime: event.target.value })}
                />
              </label>
              <label>
                End time
                <input
                  type="time"
                  value={times.dueTime}
                  onChange={(event) => changeTime({ ...times, dueTime: event.target.value })}
                />
              </label>
            </div>
          </DatePanel>
        )}
      </PropertyRow>
    </div>
  );
}

function timesOf(task: Task): { startTime: string; dueTime: string } {
  const { startTime, dueTime } = draftFrom(task);
  return { startTime, dueTime };
}
