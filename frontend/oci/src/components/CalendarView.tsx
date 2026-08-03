import { useCallback, useEffect, useRef, useState } from "react";

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
  blockMinutes,
  calendarTitle,
  draggedEdgeMinute,
  dropPatch,
  entryTime,
  hourLabel,
  isBanner,
  laneBanners,
  minuteLabel,
  monthGridDays,
  rangeOf,
  resizePatch,
  shiftAnchor,
  SNAP_MINUTES,
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

/** One rendered hour of the time grid, in px — the scale every block position,
 * resize delta, and the now-line are computed against. */
const HOUR_PX = 36;

/** Where the time grid first scrolls to: the start of the working morning. */
const SCROLL_TO_HOUR = 8;

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

/** An in-progress edge resize of a timed block. The pointer's travel from
 * originY maps to minutes at HOUR_PX per hour; `minute` is the edge's current
 * snapped, clamped position, rendered live until mouseup commits it. */
interface EdgeDrag {
  task: Task;
  edge: "start" | "end";
  day: string;
  baseMinute: number;
  otherMinute: number;
  originY: number;
  minute: number;
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

/** A short weekday name ("Fri") for a week-column header. */
function shortWeekday(dayIso: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(
    new Date(dayIso + "T00:00:00Z"),
  );
}

interface CalendarViewProps {
  onSelect?: (task: Task) => void;
}

export function CalendarView({ onSelect }: CalendarViewProps = {}): JSX.Element {
  const [mode, setMode] = useState<CalendarMode>("month");
  const [anchor, setAnchor] = useState(() => localDayOf(new Date()));
  const [tasks, setTasks] = useState<Task[]>([]);
  const [unscheduled, setUnscheduled] = useState<Task[]>([]);
  const [draft, setDraft] = useState<CreateDraft | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [drag, setDrag] = useState<HourDrag | null>(null);
  const [edgeDrag, setEdgeDrag] = useState<EdgeDrag | null>(null);
  const [now, setNow] = useState(() => new Date());
  const timeColumnsRef = useRef<HTMLDivElement | null>(null);

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

  // The now-line's clock: one tick a minute while a time grid is shown.
  useEffect(() => {
    if (mode === "month") {
      return;
    }
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, [mode]);

  // Land the time grid on the working morning, not midnight.
  useEffect(() => {
    if (mode !== "month" && timeColumnsRef.current !== null) {
      timeColumnsRef.current.scrollTop = SCROLL_TO_HOUR * HOUR_PX;
    }
  }, [mode]);

  /** Commit a block edge's new minute: optimistic render, then PATCH. */
  const applyResize = useCallback(
    async (task: Task, edge: "start" | "end", day: string, minute: number): Promise<void> => {
      const patch = resizePatch(task, edge, day, minute);
      if (patch === null) {
        return;
      }
      setTasks((current) =>
        current.map((candidate) =>
          candidate.id === task.id ? { ...candidate, ...patch } : candidate,
        ),
      );
      await updateTask(task.id, patch);
      void load();
    },
    [load],
  );

  // An active edge resize follows the pointer window-wide: the drag keeps
  // working outside the column, mouseup commits, Escape cancels.
  const resizing = edgeDrag !== null;
  useEffect(() => {
    if (!resizing) {
      return;
    }
    const onMove = (event: MouseEvent): void => {
      setEdgeDrag((current) => {
        if (current === null) {
          return current;
        }
        const deltaMinutes = ((event.clientY - current.originY) / HOUR_PX) * 60;
        return {
          ...current,
          minute: draggedEdgeMinute(
            current.edge,
            current.baseMinute,
            deltaMinutes,
            current.otherMinute,
          ),
        };
      });
    };
    const onUp = (): void => {
      setEdgeDrag((current) => {
        if (current !== null && current.minute !== current.baseMinute) {
          void applyResize(current.task, current.edge, current.day, current.minute);
        }
        return null;
      });
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setEdgeDrag(null);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [resizing, applyResize]);

  function beginEdgeDrag(
    event: React.MouseEvent,
    task: Task,
    edge: "start" | "end",
    day: string,
  ): void {
    const span = blockMinutes(task);
    if (span === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const [startMin, endMin] = span;
    const base = edge === "start" ? startMin : endMin;
    setEdgeDrag({
      task,
      edge,
      day,
      baseMinute: base,
      otherMinute: edge === "start" ? endMin : startMin,
      originY: event.clientY,
      minute: base,
    });
  }

  /** Keyboard resize on a focused handle: one snap step per arrow press. */
  function nudgeEdge(
    event: React.KeyboardEvent,
    task: Task,
    edge: "start" | "end",
    day: string,
  ): void {
    const delta =
      event.key === "ArrowUp" ? -SNAP_MINUTES : event.key === "ArrowDown" ? SNAP_MINUTES : null;
    const span = blockMinutes(task);
    if (delta === null || span === null) {
      return;
    }
    event.preventDefault();
    const [startMin, endMin] = span;
    const base = edge === "start" ? startMin : endMin;
    const minute = draggedEdgeMinute(edge, base, delta, edge === "start" ? endMin : startMin);
    if (minute !== base) {
      void applyResize(task, edge, day, minute);
    }
  }

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
    if (payload === null || payload.kind !== "task") {
      return;
    }
    const task = [...tasks, ...unscheduled].find((candidate) => candidate.id === payload.id);
    if (task === undefined) {
      return;
    }
    const patch: TaskPatch = dropPatch(task, day, hour);
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
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect?.(task);
                    }}
                  >
                    {task.title}
                  </div>
                ) : (
                  <div
                    key={task.id}
                    className="calendar-timed-entry"
                    {...taskDragProps(task)}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect?.(task);
                    }}
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

  function renderBlock(task: Task, day: string): JSX.Element | null {
    const span = blockMinutes(task);
    if (span === null) {
      return null;
    }
    const pending = edgeDrag !== null && edgeDrag.task.id === task.id ? edgeDrag : null;
    const startMin = pending?.edge === "start" ? pending.minute : span[0];
    const endMin = pending?.edge === "end" ? pending.minute : span[1];
    const start = minuteLabel(startMin);
    const end = minuteLabel(endMin);
    return (
      <div
        key={task.id}
        className="time-block"
        data-start={start}
        data-end={end}
        data-resizing={pending !== null || undefined}
        style={{
          top: (startMin / 60) * HOUR_PX,
          height: Math.max(((endMin - startMin) / 60) * HOUR_PX, HOUR_PX / 3),
        }}
        {...taskDragProps(task)}
        onClick={() => onSelect?.(task)}
      >
        <div
          className="resize-handle resize-handle-top"
          role="button"
          tabIndex={0}
          aria-label={`Resize start of "${task.title}"`}
          onMouseDown={(event) => beginEdgeDrag(event, task, "start", day)}
          onKeyDown={(event) => nudgeEdge(event, task, "start", day)}
          onClick={(event) => event.stopPropagation()}
          onDragStart={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        />
        <span className="block-title">{task.title}</span>
        <span className="block-time">
          {start}–{end}
        </span>
        <div
          className="resize-handle resize-handle-bottom"
          role="button"
          tabIndex={0}
          aria-label={`Resize end of "${task.title}"`}
          onMouseDown={(event) => beginEdgeDrag(event, task, "end", day)}
          onKeyDown={(event) => nudgeEdge(event, task, "end", day)}
          onClick={(event) => event.stopPropagation()}
          onDragStart={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        />
      </div>
    );
  }

  function renderTimeGrid(days: string[]): JSX.Element {
    const firstDay = days[0] ?? anchor;
    const today = localDayOf(now);
    const nowMinute = now.getHours() * 60 + now.getMinutes();
    return (
      <div className="time-grid">
        {days.length > 1 && (
          <div className="week-header">
            <div className="week-header-gutter" />
            {days.map((day) => (
              <div key={day} className="week-day-header" data-today={day === today || undefined}>
                <span className="day-name">{shortWeekday(day)}</span>
                <span className="day-date">
                  {Number(day.slice(8))}/{Number(day.slice(5, 7))}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="all-day-lane" aria-label="All day">
          {days.map((day) => (
            <div
              key={day}
              className="all-day-cell"
              aria-label={`${day} all-day`}
              onClick={() => openAllDayDraft(day)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => void handleDrop(event, day, null)}
            >
              {laneBanners(tasks, day, firstDay).map((task) => (
                <div
                  key={task.id}
                  className="calendar-banner"
                  {...taskDragProps(task)}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect?.(task);
                  }}
                >
                  {task.title}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div
          ref={timeColumnsRef}
          className="time-columns"
          onMouseUp={finishDrag}
          onMouseLeave={() => setDrag(null)}
        >
          <div className="hour-gutter">
            {HOURS.map((hour) => (
              <div key={hour} className="hour-label" style={{ height: HOUR_PX }}>
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
                  style={{ height: HOUR_PX }}
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
                .map((task) => renderBlock(task, day))}
              {day === today && (
                <div
                  className="now-line"
                  aria-hidden="true"
                  style={{ top: (nowMinute / 60) * HOUR_PX }}
                />
              )}
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
        {mode === "month"
          ? renderMonth()
          : renderTimeGrid(mode === "week" ? weekDays(anchor) : [anchor])}
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
