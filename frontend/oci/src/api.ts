/** Empty means same-origin: in dev the Vite server proxies /api to the backend
 * (see vite.config.ts), and a deployment behind a single ingress needs no host
 * either. Set VITE_API_BASE_URL only when the API lives on another origin. */
const BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "";

export interface TaskList {
  id: number;
  name: string;
  is_inbox: boolean;
  color: string | null;
  emoji: string | null;
  is_archived: boolean;
  folder_id: number | null;
  sort_order: number;
  view_mode: ViewMode;
}

export interface Folder {
  id: number;
  name: string;
  sort_order: number;
}

export type Priority = "none" | "low" | "medium" | "high";

/** How a List is displayed: flat or as a Kanban board of its Sections. */
export type ViewMode = "list" | "kanban";

export interface Tag {
  id: number;
  name: string;
  color: string | null;
}

export interface CheckItem {
  id: number;
  title: string;
  done: boolean;
  sort_order: number;
}

export interface Section {
  id: number;
  list_id: number;
  name: string;
  sort_order: number;
}

export interface Task {
  id: number;
  title: string;
  completed: boolean;
  /** When the task was last completed; orders the completed view, newest first. */
  completed_at: string | null;
  description: string;
  priority: Priority;
  list_id: number;
  section_id: number | null;
  sort_order: number;
  /** Schedule: UTC instants; all-day values are date-only semantics at T00:00:00Z. */
  start_date: string | null;
  due_date: string | null;
  is_all_day: boolean;
  /** IANA timezone the task was scheduled in (v1 writes the browser timezone). */
  time_zone: string | null;
  /** Reminder offsets from the task's date: signed ISO-8601 durations
   * (iCalendar TRIGGER convention: "PT0S" at time, "-PT30M" 30 min before).
   * Stored only — v1 delivers no notifications. */
  reminders: string[];
  /** Recurrence: iCalendar RRULE content (e.g. "FREQ=WEEKLY;BYDAY=MO,TH"),
   * anchored at the due date. Completing a recurring task advances its dates
   * in place instead of completing it. */
  recurrence: string | null;
  check_items: CheckItem[];
  tags: Tag[];
  created_at: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const LOGIN_PATH = "/api/v1/auth/login";
const SESSION_PATH = "/api/v1/auth/session";
const LOGOUT_PATH = "/api/v1/auth/logout";

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

/** Notified whenever any request other than login itself comes back 401 —
 * the session expired or was never there. Lets the auth gate hear about a
 * lapsed session from requests made deep in the component tree, not just
 * its own session probe. Returns an unsubscribe function. */
export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    const body = (await response.json()) as ApiErrorBody;
    if (response.status === 401 && path !== LOGIN_PATH && path !== SESSION_PATH) {
      for (const listener of unauthorizedListeners) {
        listener();
      }
    }
    throw new ApiError(body.error.code, body.error.message);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/** Asks whether the current session (if any) is still valid — the gate's
 * mount-time probe. Resolves on a valid session, rejects (401) otherwise. */
export function checkSession(): Promise<void> {
  return request(SESSION_PATH);
}

/** Exchanges the app password for a session cookie set by the response. */
export function login(password: string): Promise<void> {
  return request(LOGIN_PATH, { method: "POST", body: JSON.stringify({ password }) });
}

/** Clears the session cookie server-side. The cookie is httpOnly, so this is
 * the only way to end a session — client-side code can't delete it itself. */
export function logout(): Promise<void> {
  return request(LOGOUT_PATH, { method: "POST" });
}

export function fetchLists(): Promise<Page<TaskList>> {
  return request("/api/v1/lists");
}

export interface ListCreateInput {
  name: string;
  color?: string;
  emoji?: string;
}

export function createList(input: ListCreateInput): Promise<TaskList> {
  return request("/api/v1/lists", { method: "POST", body: JSON.stringify(input) });
}

/** Absent fields stay unchanged; null clears color/emoji or moves the List out of its Folder. */
export interface ListPatch {
  name?: string;
  color?: string | null;
  emoji?: string | null;
  is_archived?: boolean;
  folder_id?: number | null;
  sort_order?: number;
  view_mode?: ViewMode;
}

export function updateList(listId: number, patch: ListPatch): Promise<TaskList> {
  return request(`/api/v1/lists/${listId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteList(listId: number): Promise<void> {
  return request(`/api/v1/lists/${listId}`, { method: "DELETE" });
}

export function fetchFolders(): Promise<Page<Folder>> {
  return request("/api/v1/folders");
}

export function createFolder(name: string): Promise<Folder> {
  return request("/api/v1/folders", { method: "POST", body: JSON.stringify({ name }) });
}

/** Absent fields stay unchanged; explicit null is rejected by the API. */
export interface FolderPatch {
  name?: string;
  sort_order?: number;
}

export function updateFolder(folderId: number, patch: FolderPatch): Promise<Folder> {
  return request(`/api/v1/folders/${folderId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteFolder(folderId: number): Promise<void> {
  return request(`/api/v1/folders/${folderId}`, { method: "DELETE" });
}

export function fetchTasks(listId: number): Promise<Page<Task>> {
  return request(`/api/v1/tasks?list_id=${listId}`);
}

export function fetchTasksByTag(tagId: number): Promise<Page<Task>> {
  return request(`/api/v1/tasks?tag_id=${tagId}`);
}

/** The built-in Smart Lists — computed queries, never storage. */
export type SmartView = "today" | "next7" | "all";

/** Display names of the built-in Smart Lists, in sidebar order. */
export const SMART_LABELS: Record<SmartView, string> = {
  today: "Today",
  next7: "Next 7 Days",
  all: "All",
};

/** `today` is the caller's local day (YYYY-MM-DD); Smart Lists are open tasks only. */
export function fetchSmartTasks(view: SmartView, today: string): Promise<Page<Task>> {
  return request(`/api/v1/tasks?view=${view}&today=${today}`);
}

/** The completed view: per List, or across all Lists when listId is null. */
export function fetchCompletedTasks(listId: number | null): Promise<Page<Task>> {
  const scope = listId === null ? "" : `&list_id=${listId}`;
  return request(`/api/v1/tasks?completed=true${scope}`);
}

/** A Completed Occurrence — the history record one completion of a recurring
 * Task writes. The title and List are the owning task's current ones. */
export interface CompletedOccurrence {
  id: number;
  task_id: number;
  title: string;
  list_id: number;
  completed_at: string;
  /** The occurrence the user completed: the task's date before it advanced. */
  due_date: string;
  is_all_day: boolean;
}

/** Completed Occurrences, newest first: per List, or across all Lists. */
export function fetchCompletedOccurrences(
  listId: number | null,
): Promise<Page<CompletedOccurrence>> {
  const scope = listId === null ? "" : `?list_id=${listId}`;
  return request(`/api/v1/completed-occurrences${scope}`);
}

export function fetchSections(listId: number): Promise<Page<Section>> {
  return request(`/api/v1/sections?list_id=${listId}`);
}

export function createSection(listId: number, name: string): Promise<Section> {
  return request("/api/v1/sections", {
    method: "POST",
    body: JSON.stringify({ list_id: listId, name }),
  });
}

/** Absent fields stay unchanged; explicit null is rejected by the API. */
export interface SectionPatch {
  name?: string;
  sort_order?: number;
}

export function updateSection(sectionId: number, patch: SectionPatch): Promise<Section> {
  return request(`/api/v1/sections/${sectionId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteSection(sectionId: number): Promise<void> {
  return request(`/api/v1/sections/${sectionId}`, { method: "DELETE" });
}

export function fetchTags(): Promise<Page<Tag>> {
  return request("/api/v1/tags");
}

export interface TagCreateInput {
  name: string;
  color?: string;
}

export function createTag(input: TagCreateInput): Promise<Tag> {
  return request("/api/v1/tags", { method: "POST", body: JSON.stringify(input) });
}

/** Absent fields stay unchanged; explicit null clears color. */
export interface TagPatch {
  name?: string;
  color?: string | null;
}

export function updateTag(tagId: number, patch: TagPatch): Promise<Tag> {
  return request(`/api/v1/tags/${tagId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteTag(tagId: number): Promise<void> {
  return request(`/api/v1/tags/${tagId}`, { method: "DELETE" });
}

export interface TaskCreateInput {
  title: string;
  list_id?: number;
  section_id?: number;
  priority?: Priority;
  tag_ids?: number[];
  /** Schedule fields follow the same wire conventions as TaskPatch. */
  start_date?: string;
  due_date?: string;
  is_all_day?: boolean;
  time_zone?: string;
}

export function createTask(input: TaskCreateInput): Promise<Task> {
  return request("/api/v1/tasks", { method: "POST", body: JSON.stringify(input) });
}

/** Tasks whose scheduled days intersect the inclusive [start, end] day window
 * — the calendar's query (open tasks only; the window shows plans, not history). */
export function fetchCalendarTasks(rangeStart: string, rangeEnd: string): Promise<Page<Task>> {
  return request(
    `/api/v1/tasks?range_start=${rangeStart}&range_end=${rangeEnd}&completed=false&limit=200`,
  );
}

/** Undated open tasks — the unscheduled panel's query. */
export function fetchUnscheduledTasks(): Promise<Page<Task>> {
  return request("/api/v1/tasks?scheduled=false&completed=false&limit=200");
}

/** The filters a search combines with its query — null means "any". */
export interface SearchFilters {
  listId: number | null;
  tagId: number | null;
  priority: Priority | null;
  completed: boolean | null;
}

/** Tasks matching the query in title, description or Check Item titles,
 * narrowed by the filters. Callers skip the call for a blank query — the
 * API returns nothing for one. */
export function fetchSearchTasks(query: string, filters: SearchFilters): Promise<Page<Task>> {
  const params = new URLSearchParams({ search: query, limit: "200" });
  if (filters.listId !== null) {
    params.set("list_id", String(filters.listId));
  }
  if (filters.tagId !== null) {
    params.set("tag_id", String(filters.tagId));
  }
  if (filters.priority !== null) {
    params.set("priority", filters.priority);
  }
  if (filters.completed !== null) {
    params.set("completed", String(filters.completed));
  }
  return request(`/api/v1/tasks?${params.toString()}`);
}

/** Absent fields stay unchanged; explicit null is rejected by the API,
 * except section_id, where null moves the task out of its Section,
 * start_date / due_date / time_zone, where null clears the schedule, and
 * recurrence, where null stops the task repeating.
 * tag_ids replaces the task's whole tag set; reminders replaces the whole
 * reminder set ([] clears it). */
export interface TaskPatch {
  title?: string;
  completed?: boolean;
  list_id?: number;
  description?: string;
  priority?: Priority;
  tag_ids?: number[];
  section_id?: number | null;
  sort_order?: number;
  start_date?: string | null;
  due_date?: string | null;
  is_all_day?: boolean;
  time_zone?: string | null;
  reminders?: string[];
  recurrence?: string | null;
}

export function updateTask(taskId: number, patch: TaskPatch): Promise<Task> {
  return request(`/api/v1/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteTask(taskId: number): Promise<void> {
  return request(`/api/v1/tasks/${taskId}`, { method: "DELETE" });
}

/** Check Item mutations return the full parent Task (composition). */
export function createCheckItem(taskId: number, title: string): Promise<Task> {
  return request(`/api/v1/tasks/${taskId}/check-items`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

/** Absent fields stay unchanged; explicit null is rejected by the API. */
export interface CheckItemPatch {
  title?: string;
  done?: boolean;
  sort_order?: number;
}

export function updateCheckItem(
  taskId: number,
  checkItemId: number,
  patch: CheckItemPatch,
): Promise<Task> {
  return request(`/api/v1/tasks/${taskId}/check-items/${checkItemId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteCheckItem(taskId: number, checkItemId: number): Promise<void> {
  return request(`/api/v1/tasks/${taskId}/check-items/${checkItemId}`, { method: "DELETE" });
}

/** The two Habit types — named on the wire, like Priority. */
export type HabitType = "boolean" | "numeric";

/** A Habit — a recurring practice tracked by Check-ins rather than completion. */
export interface Habit {
  id: number;
  name: string;
  type: HabitType;
  /** The Numeric target and one tap's increment; Boolean habits keep 1 / 1. */
  goal: number;
  step: number;
  unit: string | null;
  icon: string | null;
  color: string | null;
  encouragement: string;
  /** RRULE frequency content: FREQ=DAILY, FREQ=WEEKLY;BYDAY=... or
   * FREQ=WEEKLY;TT_TIMES=N (N times per week). */
  frequency: string;
  /** Archived Habits leave the today screen but keep their whole history. */
  is_archived: boolean;
  created_at: string;
}

/** A Check-in — one day's progress on a Habit, keyed by (habit, date). */
export interface CheckIn {
  id: number;
  habit_id: number;
  /** The local calendar day (YYYY-MM-DD) the user checked in. */
  date: string;
  value: number;
}

/** All Habits, or — with `due` (the caller's local day) — exactly the ones
 * scheduled that day: the today's-Habits screen's query. */
export function fetchHabits(due?: string): Promise<Page<Habit>> {
  return request(due === undefined ? "/api/v1/habits" : `/api/v1/habits?due=${due}`);
}

export interface HabitCreateInput {
  name: string;
  type?: HabitType;
  goal?: number;
  step?: number;
  unit?: string;
  icon?: string;
  color?: string;
  encouragement?: string;
  frequency?: string;
}

export function createHabit(input: HabitCreateInput): Promise<Habit> {
  return request("/api/v1/habits", { method: "POST", body: JSON.stringify(input) });
}

/** Absent fields stay unchanged; explicit null clears unit / icon / color.
 * Becoming Numeric requires a goal in the same patch; becoming Boolean
 * sweeps goal / step / unit back to their defaults. */
export interface HabitPatch {
  name?: string;
  type?: HabitType;
  goal?: number;
  step?: number;
  unit?: string | null;
  icon?: string | null;
  color?: string | null;
  encouragement?: string;
  frequency?: string;
  is_archived?: boolean;
}

export function updateHabit(habitId: number, patch: HabitPatch): Promise<Habit> {
  return request(`/api/v1/habits/${habitId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

/** Deletes the Habit and its whole Check-in history. */
export function deleteHabit(habitId: number): Promise<void> {
  return request(`/api/v1/habits/${habitId}`, { method: "DELETE" });
}

/** Upsert the day's Check-in — one row per (habit, date) however often it is
 * called, so re-taps and corrections are idempotent. A Boolean check-in is
 * always value 1; a Numeric one stores the day's accumulated value. */
export function putCheckIn(habitId: number, date: string, value: number): Promise<CheckIn> {
  return request(`/api/v1/habits/${habitId}/check-ins/${date}`, {
    method: "PUT",
    body: JSON.stringify({ value }),
  });
}

/** Undo the day's Check-in (a Boolean re-tap, or a correction). */
export function removeCheckIn(habitId: number, date: string): Promise<void> {
  return request(`/api/v1/habits/${habitId}/check-ins/${date}`, { method: "DELETE" });
}

/** The day's Check-ins across every Habit — the today's-screen query. */
export function fetchCheckIns(date: string): Promise<Page<CheckIn>> {
  return request(`/api/v1/check-ins?date=${date}`);
}

/** One checked-in day of the yearly heatmap; intensity is the value's share
 * of the Goal (0..1], so Numeric habits render partial fills. */
export interface HeatmapDay {
  date: string;
  value: number;
  intensity: number;
}

/** The server-computed Habit statistics: the current Streak and one calendar
 * year of heatmap days (sparse — only days with Check-ins). */
export interface HabitStats {
  streak: number;
  heatmap: HeatmapDay[];
}

/** Statistics as of `today` (the caller's local day); `year` picks which
 * calendar year the heatmap covers, defaulting to today's. */
export function fetchHabitStats(
  habitId: number,
  today: string,
  year?: number,
): Promise<HabitStats> {
  const scope = year === undefined ? "" : `&year=${year}`;
  return request(`/api/v1/habits/${habitId}/stats?today=${today}${scope}`);
}

/** The two Focus Session modes: a Pomo counts down, a Stopwatch counts up. */
export type FocusMode = "pomo" | "stopwatch";

/** A Focus Session — one persisted period of focused work, optionally linked
 * to a Task or Habit. Timers tick client-side; the API stores finished (or
 * retroactively added) periods only. */
export interface FocusSession {
  id: number;
  mode: FocusMode;
  task_id: number | null;
  habit_id: number | null;
  started_at: string;
  ended_at: string;
  /** Wall-clock seconds spent paused: recorded focus time stays honest. */
  pause_seconds: number;
  /** Honest focus time: the wall-clock span minus the paused part (computed
   * server-side, never stored). */
  duration_seconds: number;
  note: string;
  created_at: string;
}

/** Focus Sessions, most recently started first — the history view. */
export function fetchFocusSessions(): Promise<Page<FocusSession>> {
  return request("/api/v1/focus-sessions");
}

export interface FocusSessionCreateInput {
  mode: FocusMode;
  task_id?: number;
  habit_id?: number;
  started_at: string;
  ended_at: string;
  pause_seconds?: number;
  note?: string;
}

export function createFocusSession(input: FocusSessionCreateInput): Promise<FocusSession> {
  return request("/api/v1/focus-sessions", { method: "POST", body: JSON.stringify(input) });
}

/** Absent fields stay unchanged; explicit null unlinks task_id / habit_id
 * (linking one side clears the other — at most one link ever). */
export interface FocusSessionPatch {
  task_id?: number | null;
  habit_id?: number | null;
  started_at?: string;
  ended_at?: string;
  pause_seconds?: number;
  note?: string;
}

export function updateFocusSession(
  sessionId: number,
  patch: FocusSessionPatch,
): Promise<FocusSession> {
  return request(`/api/v1/focus-sessions/${sessionId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteFocusSession(sessionId: number): Promise<void> {
  return request(`/api/v1/focus-sessions/${sessionId}`, { method: "DELETE" });
}

/** Open tasks across every List — the Focus link picker's choices. */
export function fetchOpenTasks(): Promise<Page<Task>> {
  return request("/api/v1/tasks?completed=false&limit=200");
}

/** A Timer — a saved Focus Session preset (name + mode + duration,
 * optionally pre-linked to a Task or Habit), so recurring scenarios like
 * "Reading 30m" start in one tap. */
export interface Timer {
  id: number;
  name: string;
  mode: FocusMode;
  /** The Pomo countdown length; a Stopwatch preset has none. */
  duration_seconds: number | null;
  task_id: number | null;
  habit_id: number | null;
  created_at: string;
}

export function fetchTimers(): Promise<Page<Timer>> {
  return request("/api/v1/timers");
}

export interface TimerCreateInput {
  name: string;
  mode: FocusMode;
  duration_seconds?: number;
  task_id?: number;
  habit_id?: number;
}

export function createTimer(input: TimerCreateInput): Promise<Timer> {
  return request("/api/v1/timers", { method: "POST", body: JSON.stringify(input) });
}

/** Absent fields stay unchanged; explicit null drops the duration (Stopwatch
 * presets have none) or unlinks task_id / habit_id. */
export interface TimerPatch {
  name?: string;
  mode?: FocusMode;
  duration_seconds?: number | null;
  task_id?: number | null;
  habit_id?: number | null;
}

export function updateTimer(timerId: number, patch: TimerPatch): Promise<Timer> {
  return request(`/api/v1/timers/${timerId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteTimer(timerId: number): Promise<void> {
  return request(`/api/v1/timers/${timerId}`, { method: "DELETE" });
}

export interface FocusDayTotal {
  date: string;
  seconds: number;
}

/** One Monday-started week's focus total. */
export interface FocusWeekTotal {
  start: string;
  seconds: number;
}

export interface FocusTaskTotal {
  task_id: number;
  title: string;
  seconds: number;
}

export interface FocusHabitTotal {
  habit_id: number;
  name: string;
  seconds: number;
}

/** Server-computed focus statistics over an inclusive day range — sparse:
 * only days / weeks / rows with focus appear. */
export interface FocusStats {
  days: FocusDayTotal[];
  weeks: FocusWeekTotal[];
  tasks: FocusTaskTotal[];
  habits: FocusHabitTotal[];
}

/** Statistics over [start, end]; a session counts toward the local day it
 * started in `tz` (the browser timezone). */
export function fetchFocusStats(start: string, end: string, tz: string): Promise<FocusStats> {
  return request(`/api/v1/focus-stats?start=${start}&end=${end}&tz=${encodeURIComponent(tz)}`);
}
