import { useCallback, useEffect, useState } from "react";

import {
  createTask,
  fetchCalendarTasks,
  fetchUnscheduledTasks,
  updateTask,
  type Task,
  type TaskPatch,
} from "../api";
import {
  allDayCreate,
  blockSpan,
  calendarTitle,
  dropPatch,
  entryTime,
  hourLabel,
  isBanner,
  laneBanners,
  monthGridDays,
  rangeOf,
  resizePatch,
  shiftAnchor,
  tasksOn,
  timedCreate,
  weekDays,
  type CalendarMode,
} from "../calendar";
import { localDayOf } from "../dates";
import { Icon } from "./Icon";
import { readDragPayload, startDrag } from "../dnd";

const MODES: CalendarMode[] = ["month", "week", "day"];
const MODE_LABELS: Record<CalendarMode, string> = { month: "Month", week: "Week", day: "Day" };
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const WEEKDAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** What the click/drag gesture is about to create. */
type CreateDraft =
  | { kind: "all-day"; day: string }
  | { kind: "timed"; day: string; startHour: number; endHour: number };

/** An in-progress drag across a day column's hour cells. */
interface HourDrag {
  day: string;
  from: number;
  to: number;
}

/** Banners first, then timed entries in wall-clock order. */
function byKindThenTime(a: Task, b: Task): number {
  return (
    Number(isBanner(b)) - Number(isBanner(a)) ||
    (entryTime(a) ?? "").localeCompare(entryTime(b) ?? "")
  );
}

/** The drag-source props every calendar entry shares: it drags as its task. */
function taskDragProps(
  task: Task,
): Pick<React.HTMLAttributes<HTMLElement>, "draggable" | "onDragStart"> {
  return {
    draggable: true,
    onDragStart: (event) => startDrag(event, { kind: "task", id: task.id }),
  };
}

export function CalendarView(): JSX.Element {
  const [mode, setMode] = useState<CalendarMode>("month");
  const [anchor, setAnchor] = useState(() => localDayOf(new Date()));
  const [tasks, setTasks] = useState<Task[]>([]);
  const [unscheduled, setUnscheduled] = useState<Task[]>([]);
  const [draft, setDraft] = useState<CreateDraft | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [drag, setDrag] = useState<HourDrag | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const [start, end] = rangeOf(mode, anchor);
    const [inWindow, undated] = await Promise.all([
      fetchCalendarTasks(start, end),
      fetchUnscheduledTasks(),
    ]);
    setTasks(inWindow.items);
    setUnscheduled(undated.items);
  }, [mode, anchor]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitDraft(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (draft === null) {
      return;
    }
    const title = draftTitle.trim();
    if (title === "") {
      return;
    }
    await createTask(
      draft.kind === "all-day"
        ? allDayCreate(title, draft.day)
        : timedCreate(title, draft.day, draft.startHour, draft.endHour),
    );
    setDraft(null);
    setDraftTitle("");
    void load();
  }

  function openAllDayDraft(day: string): void {
    setDraft({ kind: "all-day", day });
    setDraftTitle("");
  }

  function finishDrag(): void {
    if (drag === null) {
      return;
    }
    const from = Math.min(drag.from, drag.to);
    const to = Math.max(drag.from, drag.to);
    setDraft({ kind: "timed", day: drag.day, startHour: from, endHour: to + 1 });
    setDraftTitle("");
    setDrag(null);
  }

  async function handleDrop(
    event: React.DragEvent,
    day: string,
    hour: number | null,
  ): Promise<void> {
    const payload = readDragPayload(event);
    if (payload === null) {
      return;
    }
    const task = [...tasks, ...unscheduled].find((candidate) => candidate.id === payload.id);
    if (task === undefined) {
      return;
    }
    let patch: TaskPatch | null = null;
    if (payload.kind === "task") {
      patch = dropPatch(task, day, hour);
    } else if (
      (payload.kind === "resize-start" || payload.kind === "resize-end") &&
      hour !== null
    ) {
      patch = resizePatch(task, payload.kind === "resize-start" ? "start" : "end", day, hour);
    }
    if (patch === null) {
      return;
    }
    await updateTask(task.id, patch);
    void load();
  }

  function renderMonth(): JSX.Element {
    const days = monthGridDays(anchor);
    const anchorMonth = anchor.slice(0, 7);
    return (
      <div className="month-grid">
        {WEEKDAY_HEADERS.map((label) => (
          <div key={label} className="month-weekday">
            {label}
          </div>
        ))}
        {days.map((day) => (
          <div
            key={day}
            className="month-cell"
            aria-label={day}
            data-outside={day.slice(0, 7) !== anchorMonth || undefined}
            onClick={() => openAllDayDraft(day)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => void handleDrop(event, day, null)}
          >
            <div className="month-cell-head">
              <span>{Number(day.slice(8))}</span>
              <button
                type="button"
                aria-label={`Add a task on ${day}`}
                onClick={(event) => {
                  event.stopPropagation();
                  openAllDayDraft(day);
                }}
              >
                <Icon name="plus" size={14} />
              </button>
            </div>
            {tasksOn(tasks, day)
              .sort(byKindThenTime)
              .map((task) =>
                isBanner(task) ? (
                  <div
                    key={task.id}
                    className="calendar-banner"
                    {...taskDragProps(task)}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {task.title}
                  </div>
                ) : (
                  <div
                    key={task.id}
                    className="calendar-timed-entry"
                    {...taskDragProps(task)}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <span className="entry-time">{entryTime(task)}</span> {task.title}
                  </div>
                ),
              )}
          </div>
        ))}
      </div>
    );
  }

  function renderWeekView(): JSX.Element {
    const days = weekDays(anchor);

    const getDayName = (dayIso: string): string => {
      const date = new Date(dayIso + "T00:00:00Z");
      return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date);
    };

    const formatDuration = (start: string, end: string): string => {
      const startMs = new Date(start).getTime();
      const endMs = new Date(end).getTime();
      const minutes = Math.round((endMs - startMs) / 60000);
      if (minutes < 60) return `${minutes}m`;
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    };

    return (
      <div className="week-view">
        <div className="week-header">
          {days.map((day) => {
            const dayNum = Number(day.slice(8));
            const dayName = getDayName(day);
            return (
              <div key={day} className="week-day-header">
                <span className="day-name">{dayName}</span>
                <span className="day-date">
                  {dayNum}/{Number(day.slice(5, 7))}
                </span>
              </div>
            );
          })}
        </div>
        <div className="week-columns">
          {days.map((day) => (
            <div
              key={day}
              className="week-day-column"
              data-day={day}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => void handleDrop(event, day, null)}
            >
              {tasksOn(tasks, day)
                .sort(byKindThenTime)
                .map((task) =>
                  isBanner(task) ? (
                    <div
                      key={task.id}
                      className="week-task-card banner"
                      {...taskDragProps(task)}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {task.title}
                    </div>
                  ) : (
                    <div
                      key={task.id}
                      className="week-task-card"
                      {...taskDragProps(task)}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <span className="card-time">{entryTime(task)}</span>
                      <Icon name="calendar" size={16} />
                      <span className="card-title">{task.title}</span>
                      {blockSpan(task) && (
                        <span className="card-duration">
                          {formatDuration(
                            task.start_date ?? task.due_date ?? "",
                            task.due_date ?? "",
                          )}
                        </span>
                      )}
                    </div>
                  ),
                )}
              <div className="week-day-footer">
                <Icon name="clock" size={18} />
              </div>
              <button
                type="button"
                className="week-add-task"
                aria-label={`Add a task on ${day}`}
                onClick={() => openAllDayDraft(day)}
              >
                <Icon name="plus" size={14} />
                Add
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderTimeGrid(): JSX.Element {
    const days = [anchor];
    const firstDay = days[0] ?? anchor;
    return (
      <div className="time-grid">
        <div className="all-day-lane" aria-label="All day">
          {days.map((day) => (
            <div
              key={day}
              className="all-day-cell"
              aria-label={`${day} all-day`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => void handleDrop(event, day, null)}
            >
              {laneBanners(tasks, day, firstDay).map((task) => (
                <div key={task.id} className="calendar-banner" {...taskDragProps(task)}>
                  {task.title}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="time-columns" onMouseUp={finishDrag} onMouseLeave={() => setDrag(null)}>
          <div className="hour-gutter">
            {HOURS.map((hour) => (
              <div key={hour} className="hour-label">
                {hourLabel(hour)}
              </div>
            ))}
          </div>
          {days.map((day) => (
            <div key={day} className="day-column" data-day={day}>
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  aria-label={`${day} ${hourLabel(hour)}`}
                  className="hour-cell"
                  data-selected={
                    (drag !== null &&
                      drag.day === day &&
                      Math.min(drag.from, drag.to) <= hour &&
                      hour <= Math.max(drag.from, drag.to)) ||
                    undefined
                  }
                  onMouseDown={() => setDrag({ day, from: hour, to: hour })}
                  onMouseEnter={() =>
                    setDrag((current) =>
                      current !== null && current.day === day ? { ...current, to: hour } : current,
                    )
                  }
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => void handleDrop(event, day, hour)}
                />
              ))}
              {tasksOn(tasks, day)
                .filter((task) => !isBanner(task))
                .map((task) => {
                  const span = blockSpan(task);
                  if (span === null) {
                    return null;
                  }
                  const [start, end] = span;
                  const minutes = (time: string): number =>
                    Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
                  const top = (minutes(start) / 1440) * 100;
                  const height = Math.max(((minutes(end) - minutes(start)) / 1440) * 100, 1.5);
                  return (
                    <div
                      key={task.id}
                      className="time-block"
                      data-start={start}
                      data-end={end}
                      style={{ top: `${top}%`, height: `${height}%` }}
                      {...taskDragProps(task)}
                    >
                      <div
                        className="resize-handle resize-handle-top"
                        role="button"
                        draggable
                        aria-label={`Resize start of "${task.title}"`}
                        onDragStart={(event) => {
                          event.stopPropagation();
                          startDrag(event, { kind: "resize-start", id: task.id });
                        }}
                      />
                      <span className="block-title">{task.title}</span>
                      <span className="block-time">
                        {start}–{end}
                      </span>
                      <div
                        className="resize-handle resize-handle-bottom"
                        role="button"
                        draggable
                        aria-label={`Resize end of "${task.title}"`}
                        onDragStart={(event) => {
                          event.stopPropagation();
                          startDrag(event, { kind: "resize-end", id: task.id });
                        }}
                      />
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const draftLabel =
    draft === null
      ? null
      : draft.kind === "all-day"
        ? `New task on ${draft.day}`
        : `New task on ${draft.day}, ${hourLabel(draft.startHour)}–${hourLabel(draft.endHour)}`;

  return (
    <div className="calendar">
      <div className="calendar-toolbar">
        <h2>{calendarTitle(mode, anchor)}</h2>
        <div className="calendar-nav-buttons">
          <button
            type="button"
            aria-label="Previous"
            onClick={() => setAnchor(shiftAnchor(mode, anchor, -1))}
          >
            <Icon name="chevron-left" />
          </button>
          <button
            type="button"
            aria-label="Go to today"
            onClick={() => setAnchor(localDayOf(new Date()))}
          >
            Today
          </button>
          <button
            type="button"
            aria-label="Next"
            onClick={() => setAnchor(shiftAnchor(mode, anchor, 1))}
          >
            <Icon name="chevron-right" />
          </button>
        </div>
        <div className="calendar-modes">
          {MODES.map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={mode === candidate}
              onClick={() => setMode(candidate)}
            >
              {MODE_LABELS[candidate]}
            </button>
          ))}
        </div>
      </div>
      {draft !== null && (
        <form className="calendar-draft" onSubmit={(event) => void submitDraft(event)}>
          <span>{draftLabel}</span>
          <input
            aria-label="New task title"
            placeholder="New task title…"
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
          />
          <button type="submit">Add</button>
          <button type="button" onClick={() => setDraft(null)}>
            Cancel
          </button>
        </form>
      )}
      <div className="calendar-body">
        {mode === "month" ? renderMonth() : mode === "week" ? renderWeekView() : renderTimeGrid()}
        <aside className="unscheduled-panel" aria-label="Unscheduled">
          <h3>Unscheduled</h3>
          <ul>
            {unscheduled.map((task) => (
              <li key={task.id} {...taskDragProps(task)}>
                {task.title}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
