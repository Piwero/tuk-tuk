import { useCallback, useEffect, useRef, useState } from "react";

import {
  createList,
  createTag,
  createTask,
  fetchCalendarEvents,
  fetchCalendarTasks,
  fetchUnscheduledTasks,
  googleConnectUrl,
  updateTask,
  type Event,
  type EventFailure,
  type Priority,
  type Tag,
  type Task,
  type TaskList,
  type TaskPatch,
} from "../api";
import {
  allDayCreate,
  blockMinutes,
  blockSegment,
  calendarTitle,
  draggedEdgeMinute,
  dropPatch,
  entriesOn,
  entryTime,
  entryTimeShape,
  eventEntry,
  hourLabel,
  isBanner,
  laneBanners,
  minuteLabel,
  monthGridDays,
  rangeOf,
  resizePatch,
  shiftAnchor,
  SNAP_MINUTES,
  taskEntry,
  timedCreate,
  timeMinutes,
  weekDays,
  type CalendarMode,
  type Entry,
} from "../calendar";
import { formatDate, localDayOf } from "../dates";
import { PRIORITY_LABELS } from "../grouping";
import { applyListPick, suggestLists } from "../listSuggest";
import { applyPriorityPick, suggestPriority } from "../prioritySuggest";
import { parseQuickAdd, sameName } from "../quickAdd";
import { applyTagPick, suggestTags } from "../tagSuggest";
import { Icon } from "./Icon";
import { readDragPayload, startDrag } from "../dnd";
import { Modal } from "./Modal";
import { PomoQuickStartMenu } from "./PomoQuickStartMenu";
import { TokenInput, type TokenChannel } from "./TokenInput";

const MODES: CalendarMode[] = ["month", "week", "day"];
const MODE_LABELS: Record<CalendarMode, string> = { month: "Month", week: "Week", day: "Day" };
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const WEEKDAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** One rendered hour of the time grid, in px — the scale every block position,
 * resize delta, and the now-line are computed against. */
const HOUR_PX = 36;

/** Where the time grid first scrolls to: the start of the working morning. */
const SCROLL_TO_HOUR = 8;

/** What the click/drag gesture is about to create: a day, plus an editable
 * timeframe. `allDay` starts true from a Month-cell click and false from a
 * Week/Day drag, but the dialog lets either be flipped and the timed range
 * adjusted before it's submitted. */
interface CreateDraft {
  day: string;
  allDay: boolean;
  startMinute: number;
  endMinute: number;
}

/** The timeframe a Month-cell click's draft opens with, before any edit —
 * one working-hour block, a plausible default if "All day" gets unchecked. */
const DEFAULT_DRAFT_START_MINUTE = 9 * 60;
const DEFAULT_DRAFT_END_MINUTE = 10 * 60;

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

/** Banners first, then timed entries in wall-clock order; an Event sorts
 * before a Task at an equal time — the immovable obligation reads first. */
function byKindThenTime(a: Entry, b: Entry): number {
  const shapeA = entryTimeShape(a);
  const shapeB = entryTimeShape(b);
  return (
    Number(isBanner(shapeB)) - Number(isBanner(shapeA)) ||
    (entryTime(shapeA) ?? "").localeCompare(entryTime(shapeB) ?? "") ||
    Number(a.kind === "task") - Number(b.kind === "task")
  );
}

/** A React list key unique across both Tasks and Events sharing one list. */
function entryKey(entry: Entry): string {
  return entry.kind === "task" ? `task-${entry.task.id}` : `event-${entry.event.id}`;
}

/** The title text every entry renders, regardless of kind. */
function entryTitle(entry: Entry): string {
  return entry.kind === "task" ? entry.task.title : entry.event.title;
}

/** The drag-source props a Task-backed row shares: it drags as its task. */
function taskDragProps(
  task: Task,
): Pick<React.HTMLAttributes<HTMLElement>, "draggable" | "onDragStart"> {
  return {
    draggable: true,
    onDragStart: (event) => startDrag(event, { kind: "task", id: task.id }),
  };
}

/** The same drag-source props, for whichever kind of Entry a calendar row
 * renders: a Task drags as itself; an Event has nothing to drag — it's
 * read-only Google context, never a write target. The one place that
 * branch is made, so every rendering site shares it. */
function entryDragProps(
  entry: Entry,
): Pick<React.HTMLAttributes<HTMLElement>, "draggable" | "onDragStart"> {
  return entry.kind === "task" ? taskDragProps(entry.task) : {};
}

/** Routes a click to whichever handler its entry kind takes — a Task opens
 * the (editable) task detail panel, an Event opens its own read-only detail
 * popover (issue #110). The one place that branch is made for every click
 * handler, so no rendering site can accidentally wire an Event to a Task
 * affordance or vice versa. */
function selectEntry(
  entry: Entry,
  onSelect?: (task: Task) => void,
  onSelectEvent?: (event: Event) => void,
): void {
  if (entry.kind === "task") {
    onSelect?.(entry.task);
  } else {
    onSelectEvent?.(entry.event);
  }
}

/** Handles right-click on a calendar entry: shows PomoQuickStartMenu for Tasks,
 * does nothing for Events so the native context menu appears. */
function handleEntryContextMenu(
  event: React.MouseEvent,
  entry: Entry,
  onQuickStart?: (task: Task, position: { x: number; y: number }) => void,
): void {
  if (entry.kind === "task") {
    event.preventDefault();
    onQuickStart?.(entry.task, { x: event.clientX, y: event.clientY });
  }
}

/** A short weekday name ("Fri") for a week-column header. */
function shortWeekday(dayIso: string): string {
  return formatDate(new Date(dayIso + "T00:00:00Z"), "weekday");
}

interface CalendarViewProps {
  onSelect?: (task: Task) => void;
  onSelectEvent?: (event: Event) => void;
  /** Bumped by the caller to force a fresh read past the cache — e.g. right
   * after "Convert to task" (issue #111), so the converted Event disappears
   * and the new Task appears immediately rather than on the next natural
   * refetch (a mode/anchor change, or the window regaining focus). */
  refreshToken?: number;
  /** Powers the same `#tag`/`~list`/`!priority` autosuggest as Quick Add
   * (issue triggering this: the calendar's inline draft input took plain
   * text only). Optional so a caller without Lists/Tags loaded yet still
   * renders a working (if suggestion-less) draft input. */
  lists?: TaskList[];
  tags?: Tag[];
  onTagCreated?: (tag: Tag) => void;
  onListCreated?: (list: TaskList) => void;
}

export function CalendarView({
  onSelect,
  onSelectEvent,
  refreshToken,
  lists = [],
  tags = [],
  onTagCreated,
  onListCreated,
}: CalendarViewProps = {}): JSX.Element {
  const [mode, setMode] = useState<CalendarMode>("month");
  const [anchor, setAnchor] = useState(() => localDayOf(new Date()));
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [eventFailures, setEventFailures] = useState<EventFailure[]>([]);
  const [refreshingEvents, setRefreshingEvents] = useState(false);
  const [unscheduled, setUnscheduled] = useState<Task[]>([]);
  const [draft, setDraft] = useState<CreateDraft | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftTagChips, setDraftTagChips] = useState<Tag[]>([]);
  const [draftListChip, setDraftListChip] = useState<TaskList[]>([]);
  const [draftPriorityChip, setDraftPriorityChip] = useState<Priority[]>([]);
  const [drag, setDrag] = useState<HourDrag | null>(null);
  const [edgeDrag, setEdgeDrag] = useState<EdgeDrag | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [quickStart, setQuickStart] = useState<{
    task: Task;
    position: { x: number; y: number };
  } | null>(null);
  const timeColumnsRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(
    async (force = false): Promise<void> => {
      const [start, end] = rangeOf(mode, anchor);
      const [inWindow, undated] = await Promise.all([
        fetchCalendarTasks(start, end),
        fetchUnscheduledTasks(),
      ]);
      setTasks(inWindow.items);
      setUnscheduled(undated.items);
      // Google's own fetch, kept on its own endpoint rather than folded into
      // the Promise.all above: Tasks are already set and rendered by the
      // time this line runs, so Google's reachability never slows down Task
      // rendering (ADR 0006) regardless of how long this await takes. It's
      // awaited (rather than fire-and-forget) only so a caller of `load`
      // itself — the manual refresh button — can tell when the fresh read
      // has actually landed and stop showing its own "refreshing" state.
      // A per-account failure (issue #109) still lands here as `failures`
      // alongside whatever `events` the rest of the accounts answered —
      // only a total request failure (Google unconfigured is never an
      // error, so this is a genuine network/parse failure reaching this
      // client) blanks the Calendar's Events outright.
      await fetchCalendarEvents(start, end, force)
        .then((result) => {
          setEvents(result.events);
          setEventFailures(result.failures);
        })
        .catch(() => {
          setEvents([]);
          setEventFailures([]);
        });
    },
    [mode, anchor],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // A caller-driven forced refresh (issue #111's "Convert to task"): skips
  // its own first run, since mount is already covered by the effect above —
  // only a later change of refreshToken means the caller actually wants one.
  const skipNextRefreshToken = useRef(true);
  useEffect(() => {
    if (skipNextRefreshToken.current) {
      skipNextRefreshToken.current = false;
      return;
    }
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  // Exactly the moment a Calendar left open in a background tab is most
  // likely stale: the user just came back from Google Calendar or their
  // mail (issue #109). Forces past the backend's short-lived cache — a
  // plain refetch could still be served yesterday's cached answer if focus
  // lands within the cache's TTL, defeating the point of refetching here.
  useEffect(() => {
    function handleFocus(): void {
      void load(true);
    }
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [load]);

  /** The Calendar toolbar's one refresh control: forces a fresh read past
   * the backend's short-lived cache, and doubles as the Retry affordance
   * for any account currently reported in `eventFailures` (issue #109). */
  async function handleRefreshEvents(): Promise<void> {
    setRefreshingEvents(true);
    try {
      await load(true);
    } finally {
      setRefreshingEvents(false);
    }
  }

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
    // Same chip-wins-over-same-named-token rule as Quick Add's submit.
    const plan = parseQuickAdd(draftTitle, lists, {
      skipListToken: draftListChip.length > 0,
      skipPriorityToken: draftPriorityChip.length > 0,
    });
    if (plan.title === "") {
      return;
    }
    const tagIds: number[] = [];
    const seen: string[] = [];
    for (const chip of draftTagChips) {
      if (!seen.some((name) => sameName(name, chip.name))) {
        seen.push(chip.name);
        tagIds.push(chip.id);
      }
    }
    for (const name of plan.tagNames) {
      if (seen.some((seenName) => sameName(seenName, name))) {
        continue;
      }
      seen.push(name);
      const existing = tags.find((tag) => sameName(tag.name, name));
      if (existing !== undefined) {
        tagIds.push(existing.id);
      } else {
        const created = await createTag({ name });
        onTagCreated?.(created);
        tagIds.push(created.id);
      }
    }
    const finalListId = draftListChip[0]?.id ?? plan.listId ?? undefined;
    const finalPriority = draftPriorityChip[0] ?? plan.priority;
    const base = draft.allDay
      ? allDayCreate(plan.title, draft.day)
      : timedCreate(plan.title, draft.day, draft.startMinute, draft.endMinute);
    await createTask({
      ...base,
      ...(finalListId === undefined ? {} : { list_id: finalListId }),
      ...(finalPriority === null || finalPriority === undefined ? {} : { priority: finalPriority }),
      ...(tagIds.length === 0 ? {} : { tag_ids: tagIds }),
    });
    resetDraft();
    void load();
  }

  function resetDraft(): void {
    setDraft(null);
    setDraftTitle("");
    setDraftTagChips([]);
    setDraftListChip([]);
    setDraftPriorityChip([]);
  }

  function openAllDayDraft(day: string): void {
    setDraft({
      day,
      allDay: true,
      startMinute: DEFAULT_DRAFT_START_MINUTE,
      endMinute: DEFAULT_DRAFT_END_MINUTE,
    });
    setDraftTitle("");
    setDraftTagChips([]);
    setDraftListChip([]);
    setDraftPriorityChip([]);
  }

  function finishDrag(): void {
    if (drag === null) {
      return;
    }
    const from = Math.min(drag.from, drag.to);
    const to = Math.max(drag.from, drag.to);
    setDraft({
      day: drag.day,
      allDay: false,
      startMinute: from * 60,
      endMinute: Math.min((to + 1) * 60, 1440),
    });
    setDraftTitle("");
    setDraftTagChips([]);
    setDraftListChip([]);
    setDraftPriorityChip([]);
    setDrag(null);
  }

  /** Sets the draft's start, keeping it at least one snap step before the
   * end — dragging the start past the end pushes the end along with it. */
  function setDraftStart(value: string): void {
    const startMinute = timeMinutes(value);
    setDraft((current) =>
      current === null
        ? current
        : {
            ...current,
            startMinute,
            endMinute: Math.max(current.endMinute, startMinute + SNAP_MINUTES),
          },
    );
  }

  /** Sets the draft's end, keeping it at least one snap step after the
   * start — the mirror of setDraftStart. */
  function setDraftEnd(value: string): void {
    const endMinute = timeMinutes(value);
    setDraft((current) =>
      current === null
        ? current
        : {
            ...current,
            endMinute,
            startMinute: Math.min(current.startMinute, endMinute - SNAP_MINUTES),
          },
    );
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

  const entries: Entry[] = [...tasks.map(taskEntry), ...events.map(eventEntry)];

  function renderMonth(): JSX.Element {
    const days = monthGridDays(anchor);
    const anchorMonth = anchor.slice(0, 7);
    // Read fresh rather than off the `now` state, which only ticks while a
    // time grid (Week/Day) is mounted (see the now-line effect above) — the
    // Month cell only needs the current day, not a live-updating clock.
    const today = localDayOf(new Date());
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
            data-today={day === today || undefined}
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
            {entriesOn(entries, day)
              .sort(byKindThenTime)
              .map((entry) =>
                isBanner(entryTimeShape(entry)) ? (
                  <div
                    key={entryKey(entry)}
                    className="calendar-banner"
                    data-kind={entry.kind}
                    {...entryDragProps(entry)}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectEntry(entry, onSelect, onSelectEvent);
                    }}
                    onContextMenu={(event) => {
                      event.stopPropagation();
                      handleEntryContextMenu(event, entry, (task, position) =>
                        setQuickStart({ task, position }),
                      );
                    }}
                  >
                    {entryTitle(entry)}
                  </div>
                ) : (
                  <div
                    key={entryKey(entry)}
                    className="calendar-timed-entry"
                    data-kind={entry.kind}
                    {...entryDragProps(entry)}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectEntry(entry, onSelect, onSelectEvent);
                    }}
                    onContextMenu={(event) => {
                      event.stopPropagation();
                      handleEntryContextMenu(event, entry, (task, position) =>
                        setQuickStart({ task, position }),
                      );
                    }}
                  >
                    <span className="entry-time">{entryTime(entryTimeShape(entry))}</span>{" "}
                    {entryTitle(entry)}
                  </div>
                ),
              )}
          </div>
        ))}
      </div>
    );
  }

  function renderBlock(entry: Entry, day: string): JSX.Element | null {
    const segment = blockSegment(entryTimeShape(entry), day);
    if (segment === null) {
      return null;
    }
    const { continuesBefore, continuesAfter } = segment;
    const task = entry.kind === "task" ? entry.task : null;
    const pending =
      edgeDrag !== null && task !== null && edgeDrag.task.id === task.id ? edgeDrag : null;
    const startMin = pending?.edge === "start" ? pending.minute : segment.minutes[0];
    const endMin = pending?.edge === "end" ? pending.minute : segment.minutes[1];
    const start = minuteLabel(startMin);
    const end = minuteLabel(endMin);
    const title = entryTitle(entry);
    return (
      <div
        key={`${entryKey(entry)}-${day}`}
        className="time-block"
        data-kind={entry.kind}
        data-start={start}
        data-end={end}
        data-continues-before={continuesBefore || undefined}
        data-continues-after={continuesAfter || undefined}
        data-resizing={pending !== null || undefined}
        style={{
          top: (startMin / 60) * HOUR_PX,
          height: Math.max(((endMin - startMin) / 60) * HOUR_PX, HOUR_PX / 3),
        }}
        {...entryDragProps(entry)}
        onClick={() => selectEntry(entry, onSelect, onSelectEvent)}
        onContextMenu={(event) =>
          handleEntryContextMenu(event, entry, (task, position) =>
            setQuickStart({ task, position }),
          )
        }
      >
        {task !== null && (
          <div
            className="resize-handle resize-handle-top"
            role="button"
            tabIndex={0}
            aria-label={`Resize start of "${title}"`}
            onMouseDown={(event) => beginEdgeDrag(event, task, "start", day)}
            onKeyDown={(event) => nudgeEdge(event, task, "start", day)}
            onClick={(event) => event.stopPropagation()}
            onDragStart={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          />
        )}
        <span className="block-title">{title}</span>
        <span className="block-time">
          {start}–{end}
        </span>
        {task !== null && (
          <div
            className="resize-handle resize-handle-bottom"
            role="button"
            tabIndex={0}
            aria-label={`Resize end of "${title}"`}
            onMouseDown={(event) => beginEdgeDrag(event, task, "end", day)}
            onKeyDown={(event) => nudgeEdge(event, task, "end", day)}
            onClick={(event) => event.stopPropagation()}
            onDragStart={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          />
        )}
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
              {laneBanners(entries, day, firstDay).map((entry) => (
                <div
                  key={entryKey(entry)}
                  className="calendar-banner"
                  data-kind={entry.kind}
                  {...entryDragProps(entry)}
                  onClick={(event) => {
                    event.stopPropagation();
                    selectEntry(entry, onSelect, onSelectEvent);
                  }}
                  onContextMenu={(event) => {
                    event.stopPropagation();
                    handleEntryContextMenu(event, entry, (task, position) =>
                      setQuickStart({ task, position }),
                    );
                  }}
                >
                  {entryTitle(entry)}
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
              {entriesOn(entries, day)
                .filter((entry) => !isBanner(entryTimeShape(entry)))
                .map((entry) => renderBlock(entry, day))}
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

  const draftLabel = draft === null ? null : `New task on ${draft.day}`;

  // Same three channels as Quick Add (#126) — the calendar's inline draft
  // input gets the same `#tag`/`~list`/`!priority` autosuggest rather than a
  // second, divergent implementation.
  const draftTagChannel: TokenChannel<Tag> = {
    sigil: "#",
    mode: "multi",
    chips: draftTagChips,
    onChipsChange: setDraftTagChips,
    getId: (tag) => tag.id,
    getLabel: (tag) => tag.name,
    suggest: (text, caret) => suggestTags(text, caret, tags),
    applyPick: applyTagPick,
    allowCreate: true,
    onCreate: (name) => createTag({ name }),
    onCreated: (tag) => onTagCreated?.(tag),
    createLabel: (name) => `Create tag "${name}"`,
    removeAriaLabel: (tag) => `Remove ${tag.name}`,
  };

  const draftListChannel: TokenChannel<TaskList> = {
    sigil: "~",
    mode: "single",
    chips: draftListChip,
    onChipsChange: setDraftListChip,
    getId: (list) => list.id,
    getLabel: (list) => list.name,
    suggest: (text, caret) => suggestLists(text, caret, lists),
    applyPick: applyListPick,
    allowCreate: true,
    onCreate: (name) => createList({ name }),
    onCreated: (list) => onListCreated?.(list),
    createLabel: (name) => `Create list "${name}"`,
    removeAriaLabel: (list) => `Remove ${list.name}`,
  };

  const draftPriorityChannel: TokenChannel<Priority> = {
    sigil: "!",
    mode: "single",
    chips: draftPriorityChip,
    onChipsChange: setDraftPriorityChip,
    getId: (priority) => priority,
    getLabel: (priority) => PRIORITY_LABELS[priority],
    suggest: (text, caret) => suggestPriority(text, caret),
    applyPick: applyPriorityPick,
    allowCreate: false,
    createLabel: (name) => name,
    removeAriaLabel: (priority) => `Remove ${priority}`,
  };

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
        <button
          type="button"
          aria-label="Refresh Events"
          className="calendar-refresh-button"
          onClick={() => void handleRefreshEvents()}
          disabled={refreshingEvents}
        >
          <Icon name="refresh-cw" />
        </button>
      </div>
      {eventFailures.length > 0 && (
        <div className="calendar-event-failures" role="alert">
          {eventFailures.map((failure) => (
            <p key={failure.account_id}>
              {failure.kind === "terminal" ? (
                <>
                  {failure.email} needs to be reconnected before its Events can show again.{" "}
                  <a href={googleConnectUrl()} className="button">
                    Reconnect
                  </a>
                </>
              ) : (
                <>{failure.email} didn't respond — showing Events from every other account.</>
              )}
            </p>
          ))}
        </div>
      )}
      {draft !== null && draftLabel !== null && (
        <Modal title={draftLabel} onClose={resetDraft}>
          <form className="calendar-draft" onSubmit={(event) => void submitDraft(event)}>
            <TokenInput
              ariaLabel="New task title"
              placeholder="New task title…"
              value={draftTitle}
              onValueChange={setDraftTitle}
              channels={[
                draftTagChannel as TokenChannel<unknown>,
                draftListChannel as TokenChannel<unknown>,
                draftPriorityChannel as TokenChannel<unknown>,
              ]}
              autoFocus
            />
            <label className="calendar-draft-allday">
              <input
                type="checkbox"
                checked={draft.allDay}
                onChange={(event) =>
                  setDraft((current) =>
                    current === null ? current : { ...current, allDay: event.target.checked },
                  )
                }
              />
              All day
            </label>
            {!draft.allDay && (
              <div className="calendar-draft-timeframe">
                <label>
                  Start
                  <input
                    type="time"
                    aria-label="Start time"
                    value={minuteLabel(draft.startMinute)}
                    onChange={(event) => setDraftStart(event.target.value)}
                  />
                </label>
                <label>
                  End
                  <input
                    type="time"
                    aria-label="End time"
                    value={minuteLabel(draft.endMinute)}
                    onChange={(event) => setDraftEnd(event.target.value)}
                  />
                </label>
              </div>
            )}
            <div className="calendar-draft-actions">
              <button type="submit">Add</button>
              <button type="button" onClick={() => resetDraft()}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
      <div className="calendar-body">
        {mode === "month"
          ? renderMonth()
          : renderTimeGrid(mode === "week" ? weekDays(anchor) : [anchor])}
        <aside className="unscheduled-panel" aria-label="Unscheduled">
          <h3>Unscheduled</h3>
          {unscheduled.length === 0 ? (
            <p className="unscheduled-empty-hint">
              Nothing unscheduled — Tasks without a date land here; drag one onto the calendar to
              schedule it.
            </p>
          ) : (
            <ul>
              {unscheduled.map((task) => (
                <li key={task.id} {...taskDragProps(task)}>
                  {task.title}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
      {quickStart !== null && (
        <PomoQuickStartMenu
          task={quickStart.task}
          position={quickStart.position}
          onClose={() => setQuickStart(null)}
        />
      )}
    </div>
  );
}
