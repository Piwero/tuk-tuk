import { vi } from "vitest";

import {
  type AssistantChatTurn,
  type AssistCaptureDraft,
  type HabitType,
  type Priority,
  type ViewMode,
} from "../api";
import { entryDayWindow } from "../calendar";
import { addDays } from "../dates";
import { habitDueOn } from "../habitFrequency";
import { byName, SORT_GAP } from "../ordering";
import { decrementCount, nextOccurrenceISO } from "./fakeRecurrence";

export interface FakeList {
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

export interface FakeFolder {
  id: number;
  name: string;
  sort_order: number;
}

export interface FakeSection {
  id: number;
  list_id: number;
  name: string;
  sort_order: number;
}

export interface FakeTag {
  id: number;
  name: string;
  color: string | null;
}

export interface FakeCheckItem {
  id: number;
  title: string;
  done: boolean;
  sort_order: number;
}

export interface FakeTask {
  id: number;
  title: string;
  completed: boolean;
  completed_at: string | null;
  description: string;
  priority: Priority;
  list_id: number;
  section_id: number | null;
  sort_order: number;
  start_date: string | null;
  due_date: string | null;
  is_all_day: boolean;
  time_zone: string | null;
  reminders: string[];
  recurrence: string | null;
  source_google_calendar_id: number | null;
  source_google_event_id: string | null;
  check_items: FakeCheckItem[];
  tags: FakeTag[];
  created_at: string;
}

export interface RecordedRequest {
  method: string;
  url: string;
  body?: unknown;
}

export interface FakeCompletedOccurrence {
  id: number;
  task_id: number;
  title: string;
  list_id: number;
  completed_at: string;
  due_date: string;
  is_all_day: boolean;
}

export interface FakeHabit {
  id: number;
  name: string;
  type: HabitType;
  goal: number;
  step: number;
  unit: string | null;
  icon: string | null;
  color: string | null;
  encouragement: string;
  frequency: string;
  is_archived: boolean;
  created_at: string;
}

export interface FakeCheckIn {
  id: number;
  habit_id: number;
  date: string;
  value: number;
}

export interface FakeFocusSession {
  id: number;
  mode: "pomo" | "stopwatch";
  task_id: number | null;
  habit_id: number | null;
  started_at: string;
  ended_at: string;
  pause_seconds: number;
  note: string;
  created_at: string;
}

export interface FakeTimer {
  id: number;
  name: string;
  mode: "pomo" | "stopwatch";
  duration_seconds: number | null;
  task_id: number | null;
  habit_id: number | null;
  created_at: string;
}

export type StandupSection = "yesterday" | "today" | "blockers";

export interface FakeStandupBullet {
  id: number;
  section: StandupSection;
  text: string;
  sort_order: number;
}

export interface FakeStandupEntry {
  id: number;
  date: string;
  sprint_goal_snapshot: string;
  bullets: FakeStandupBullet[];
}

/** A Yesterday-section suggestion chip (issue #141). The fake never derives
 * this from `tasks`/`completedOccurrences` or filters by date — that
 * date-scoped query logic is the backend's, exercised in the backend
 * suite; a test seeds exactly the chips it wants visible. */
export interface FakeStandupYesterdaySuggestion {
  title: string;
}

export interface FakeGoogleAccount {
  id: number;
  google_account_id: string;
  email: string;
  connection_state: string;
  created_at: string;
}

export interface FakeGoogleCalendar {
  id: number;
  account_id: number;
  google_calendar_id: string;
  summary: string;
  color: string;
  enabled: boolean;
}

export interface FakeEventAttendee {
  email: string;
  display_name: string | null;
}

export interface FakeEvent {
  id: string;
  title: string;
  start_date: string;
  due_date: string;
  is_all_day: boolean;
  color: string;
  location: string | null;
  description: string | null;
  attendees: FakeEventAttendee[];
  organizer: FakeEventAttendee | null;
  html_link: string;
  account_email: string;
  calendar_summary: string;
  calendar_id: number;
  google_event_id: string;
}

/** A per-account Events failure (issue #109) the fake `/api/v1/events`
 * route answers alongside whatever `events` it has — the fake never
 * derives this from a simulated Google outage (that's the backend's job,
 * exercised in the backend suite); a test that wants one simply seeds it
 * here directly. */
export interface FakeEventFailure {
  account_id: number;
  email: string;
  kind: "transient" | "terminal";
  message: string;
}

export interface FakeApiState {
  lists: FakeList[];
  folders: FakeFolder[];
  sections: FakeSection[];
  tags: FakeTag[];
  tasks: FakeTask[];
  completedOccurrences: FakeCompletedOccurrence[];
  habits: FakeHabit[];
  checkIns: FakeCheckIn[];
  focusSessions: FakeFocusSession[];
  timers: FakeTimer[];
  requests: RecordedRequest[];
  /** Mutate directly to simulate a session lapsing mid-test. */
  loggedIn: boolean;
  /** The password the fake login and change-password routes check against;
   * starts at FAKE_PASSWORD, and a successful fake change-password call
   * updates it — mirrors the backend hash living in `settings`. */
  password: string;
  /** Mirrors a fresh deployment with no password set yet (ADR 0008):
   * every route but /health, /login, and /setup answers "setup_required"
   * regardless of `loggedIn`. Cleared by a successful fake /setup call. */
  needsSetup: boolean;
  /** Mirrors the backend's google_client_id/secret gate: whether the Google
   * integration is configured server-side. */
  googleConfigured: boolean;
  /** The stored client ID, echoed back by /status — not sensitive, unlike
   * the secret, which is never returned (only whether one is set). */
  googleClientId: string | null;
  googleClientSecretSet: boolean;
  googleAccounts: FakeGoogleAccount[];
  googleCalendars: FakeGoogleCalendar[];
  events: FakeEvent[];
  eventFailures: FakeEventFailure[];
  standupEntries: FakeStandupEntry[];
  standupYesterdaySuggestions: FakeStandupYesterdaySuggestion[];
  sprintGoal: string;
  /** The Stand-up visibility toggle (issue #140) — server-defaulted to
   * true, matching the backend's default. */
  standupEnabled: boolean;
  activeHours: { enabled: boolean; start: string; end: string };
  /** Mirrors the backend's Assist status probe (ADR 0005, issue #42):
   * whether Ollama is reachable and the configured model is installed.
   * Defaults to false, matching a fresh deployment with no Ollama
   * settings configured. */
  assistAvailable: boolean;
  /** The Assist config Settings reads/writes (ADR 0005). Both null by
   * default, matching a fresh deployment with nothing configured yet —
   * independent of `assistAvailable`, which a test sets directly rather
   * than deriving from these (mirrors the backend/fake split for Google:
   * status and config are asked separately). */
  assistOllamaBaseUrl: string | null;
  assistModel: string | null;
  /** What the Assist models endpoint answers with (ADR 0005) — the
   * Settings dropdown's source. Answered regardless of the requested
   * `base_url`, unlike the backend's real reachability check (exercised in
   * the backend suite); a test wanting "no models" simply doesn't seed
   * this. */
  assistInstalledModels: string[];
  /** Assisted Capture's parse result (ADR 0005; issue #43). `null` (the
   * default) makes the fake echo back the plain-capture fallback the real
   * backend answers with when nothing was extracted — the text unchanged,
   * no date — so a test only sets this when it wants a draft with a date
   * to confirm or discard. */
  assistParseResult: AssistCaptureDraft | null;
  /** When true, POST /api/v1/assist/parse-capture answers with a server
   * error instead of a draft — simulates a parse failure the real backend
   * would otherwise absorb into a plain-capture fallback itself, letting a
   * test exercise Quick-Add's own client-side degrade-to-plain-capture
   * `catch` path (issue #43). */
  assistParseFails: boolean;
  /** Mirrors the backend's Assistant status probe (ADR 0009, issue #185):
   * whether the configured provider is reachable and authenticated.
   * Defaults to false, matching a fresh deployment with nothing
   * configured. Entirely independent of `assistAvailable`. */
  assistantAvailable: boolean;
  /** The Assistant's provider config Settings reads/writes (ADR 0009). All
   * null/unset by default, matching a fresh deployment. */
  assistantBaseUrl: string | null;
  assistantModel: string | null;
  assistantApiKeySet: boolean;
  assistantPlanningPreferences: string | null;
  /** Queued POST /api/v1/assistant/chat responses (ADR 0009, issue #188):
   * one shift()'d per call. A test pushes onto this array (the field is
   * mutable and returned live via installFakeApi's FakeApiState) to script
   * what a turn answers; an empty queue falls back to the same apologetic,
   * no-suggestions turn the real backend returns for an unconfigured
   * provider. */
  assistantChatQueue: AssistantChatTurn[];
}

/** The password installFakeApi's fake login route accepts. */
export const FAKE_PASSWORD = "correct-password";

export const INBOX: FakeList = {
  id: 1,
  name: "Inbox",
  is_inbox: true,
  color: null,
  emoji: null,
  is_archived: false,
  folder_id: null,
  sort_order: 0,
  view_mode: "list",
};

let nextTaskId = 100;
let nextListId = 10;
let nextFolderId = 500;
let nextCheckItemId = 900;
let nextTagId = 700;
let nextSectionId = 800;
let nextOccurrenceId = 950;
let nextHabitId = 300;
let nextCheckInId = 9000;
let nextFocusSessionId = 400;
let nextTimerId = 450;
let nextStandupEntryId = 600;
let nextStandupBulletId = 650;

export function fakeStandupEntry(
  date: string,
  overrides: Partial<Omit<FakeStandupEntry, "id" | "date">> = {},
): FakeStandupEntry {
  return {
    id: nextStandupEntryId++,
    date,
    sprint_goal_snapshot: "",
    bullets: [],
    ...overrides,
  };
}

export function fakeTask(title: string, overrides: Partial<FakeTask> = {}): FakeTask {
  const id = nextTaskId++;
  return {
    id,
    title,
    completed: false,
    completed_at: null,
    description: "",
    priority: "none",
    list_id: INBOX.id,
    section_id: null,
    sort_order: id * SORT_GAP,
    start_date: null,
    due_date: null,
    is_all_day: false,
    time_zone: null,
    reminders: [],
    recurrence: null,
    source_google_calendar_id: null,
    source_google_event_id: null,
    check_items: [],
    tags: [],
    created_at: "2026-07-03T10:00:00Z",
    ...overrides,
  };
}

export function fakeSection(
  name: string,
  listId: number,
  overrides: Partial<FakeSection> = {},
): FakeSection {
  const id = nextSectionId++;
  return { id, list_id: listId, name, sort_order: id * SORT_GAP, ...overrides };
}

export function fakeTag(name: string, overrides: Partial<FakeTag> = {}): FakeTag {
  return { id: nextTagId++, name, color: null, ...overrides };
}

export function fakeCheckItem(
  title: string,
  overrides: Partial<FakeCheckItem> = {},
): FakeCheckItem {
  const id = nextCheckItemId++;
  return { id, title, done: false, sort_order: id * SORT_GAP, ...overrides };
}

export function fakeList(name: string, overrides: Partial<FakeList> = {}): FakeList {
  const id = nextListId++;
  return {
    id,
    name,
    is_inbox: false,
    color: null,
    emoji: null,
    is_archived: false,
    folder_id: null,
    sort_order: id * SORT_GAP,
    view_mode: "list",
    ...overrides,
  };
}

export function fakeFolder(name: string, overrides: Partial<FakeFolder> = {}): FakeFolder {
  const id = nextFolderId++;
  return { id, name, sort_order: id * SORT_GAP, ...overrides };
}

export function fakeHabit(name: string, overrides: Partial<FakeHabit> = {}): FakeHabit {
  return {
    id: nextHabitId++,
    name,
    type: "boolean",
    goal: 1,
    step: 1,
    unit: null,
    icon: null,
    color: null,
    encouragement: "",
    frequency: "FREQ=DAILY",
    is_archived: false,
    created_at: "2026-07-03T10:00:00Z",
    ...overrides,
  };
}

let nextEventId = 1;

export function fakeEvent(title: string, overrides: Partial<FakeEvent> = {}): FakeEvent {
  const n = nextEventId++;
  return {
    id: `evt-${n}`,
    title,
    start_date: "2026-07-03T13:00:00Z",
    due_date: "2026-07-03T14:00:00Z",
    is_all_day: false,
    color: "#4772fa",
    location: null,
    description: null,
    attendees: [],
    organizer: null,
    html_link: "https://calendar.google.com/calendar/event?eid=fake",
    account_email: "me@example.com",
    calendar_summary: "Work",
    calendar_id: 1,
    google_event_id: `google-evt-${n}`,
    ...overrides,
  };
}

export function fakeTimer(name: string, overrides: Partial<FakeTimer> = {}): FakeTimer {
  return {
    id: nextTimerId++,
    name,
    mode: "pomo",
    duration_seconds: 1500,
    task_id: null,
    habit_id: null,
    created_at: "2026-07-03T10:00:00Z",
    ...overrides,
  };
}

export function fakeFocusSession(overrides: Partial<FakeFocusSession> = {}): FakeFocusSession {
  return {
    id: nextFocusSessionId++,
    mode: "stopwatch",
    task_id: null,
    habit_id: null,
    started_at: "2026-07-03T09:00:00Z",
    ended_at: "2026-07-03T09:30:00Z",
    pause_seconds: 0,
    note: "",
    created_at: "2026-07-03T09:30:00Z",
    ...overrides,
  };
}

const nextOrder = (rows: { sort_order: number }[]): number =>
  Math.max(0, ...rows.map((row) => row.sort_order)) + SORT_GAP;

/** Fakes the HTTP API at the fetch boundary and records every request. */
export function installFakeApi({
  lists = [INBOX],
  folders = [],
  sections = [],
  tags = [],
  tasks = [],
  completedOccurrences = [],
  habits = [],
  checkIns = [],
  focusSessions = [],
  timers = [],
  loggedIn = true,
  needsSetup = false,
  googleConfigured = false,
  googleClientId = null,
  googleClientSecretSet = false,
  googleAccounts = [],
  googleCalendars = [],
  events = [],
  eventFailures = [],
  standupEntries = [],
  standupYesterdaySuggestions = [],
  sprintGoal = "",
  standupEnabled = true,
  activeHours = { enabled: false, start: "09:00", end: "17:00" },
  assistAvailable = false,
  assistOllamaBaseUrl = null,
  assistModel = null,
  assistInstalledModels = [],
  assistParseResult = null,
  assistParseFails = false,
  assistantAvailable = false,
  assistantBaseUrl = null,
  assistantModel = null,
  assistantApiKeySet = false,
  assistantPlanningPreferences = null,
  assistantChatQueue = [],
}: {
  lists?: FakeList[];
  folders?: FakeFolder[];
  sections?: FakeSection[];
  tags?: FakeTag[];
  tasks?: FakeTask[];
  completedOccurrences?: FakeCompletedOccurrence[];
  habits?: FakeHabit[];
  checkIns?: FakeCheckIn[];
  focusSessions?: FakeFocusSession[];
  timers?: FakeTimer[];
  /** Start unauthenticated: every non-auth route is rejected until a fake
   * login succeeds. */
  loggedIn?: boolean;
  /** Start on a fresh deployment with no password set (ADR 0008). */
  needsSetup?: boolean;
  /** Absent (false) by default, matching the backend's default-off gate. */
  googleConfigured?: boolean;
  googleClientId?: string | null;
  googleClientSecretSet?: boolean;
  googleAccounts?: FakeGoogleAccount[];
  /** Pre-seeded as if already fetched once — the fake never re-derives
   * this from a Google-side `selected` flag; that seeding rule is the
   * backend's, exercised in the backend suite. */
  googleCalendars?: FakeGoogleCalendar[];
  /** Google Calendar Events (issue #107) the calendar's own read-only
   * endpoint answers with — never filtered by calendar `enabled` here,
   * since that filtering is the backend's job (exercised in the backend
   * suite); a test that wants a disabled-calendar's Events hidden simply
   * doesn't seed them here. */
  events?: FakeEvent[];
  /** Per-account Events failures (issue #109) the fake reports on every
   * `/api/v1/events` read — never cleared or derived by the fake itself; a
   * test simulating Retry/refresh recovering seeds a fresh `installFakeApi`
   * (or mutates `api.eventFailures` directly) instead. */
  eventFailures?: FakeEventFailure[];
  standupEntries?: FakeStandupEntry[];
  /** Yesterday-section suggestion chips (issue #141), served as-is by the
   * fake's suggestions route regardless of the requested `date`. */
  standupYesterdaySuggestions?: FakeStandupYesterdaySuggestion[];
  /** The live Sprint goal (issue #139) — never touches existing Entries'
   * `sprint_goal_snapshot`, only what a newly-created Entry copies. */
  sprintGoal?: string;
  /** The Stand-up visibility toggle (issue #140). Defaults to true, matching
   * the backend's server-defaulted-true column. */
  standupEnabled?: boolean;
  /** Active hours (issue #210) -- the Calendar's double-height band.
   * Defaults to disabled, matching the backend. */
  activeHours?: { enabled: boolean; start: string; end: string };
  /** The Assist availability probe's answer (ADR 0005, issue #42). */
  assistAvailable?: boolean;
  /** The saved Assist config Settings reads on mount (ADR 0005). */
  assistOllamaBaseUrl?: string | null;
  assistModel?: string | null;
  /** What GET /api/v1/assist/models answers with (ADR 0005). */
  assistInstalledModels?: string[];
  /** What POST /api/v1/assist/parse-capture answers with (issue #43); null
   * means "echo the plain-capture fallback" (see the field's own doc). */
  assistParseResult?: AssistCaptureDraft | null;
  /** Makes POST /api/v1/assist/parse-capture answer with a server error
   * instead (issue #43) — see the field's own doc. */
  assistParseFails?: boolean;
  /** The Assistant availability probe's answer (ADR 0009, issue #185). */
  assistantAvailable?: boolean;
  /** The saved Assistant config Settings reads on mount (ADR 0009). */
  assistantBaseUrl?: string | null;
  assistantModel?: string | null;
  assistantApiKeySet?: boolean;
  assistantPlanningPreferences?: string | null;
  /** Queued chat turns (ADR 0009, issue #188) — see the field's own doc. */
  assistantChatQueue?: AssistantChatTurn[];
} = {}): FakeApiState {
  const state: FakeApiState = {
    lists: lists.map((list) => ({ ...list })),
    folders: folders.map((folder) => ({ ...folder })),
    sections: sections.map((section) => ({ ...section })),
    tags: tags.map((tag) => ({ ...tag })),
    tasks: tasks.map((task) => ({
      ...task,
      check_items: [...task.check_items],
      tags: task.tags.map((tag) => ({ ...tag })),
    })),
    completedOccurrences: completedOccurrences.map((occurrence) => ({ ...occurrence })),
    habits: habits.map((habit) => ({ ...habit })),
    checkIns: checkIns.map((checkIn) => ({ ...checkIn })),
    focusSessions: focusSessions.map((focusSession) => ({ ...focusSession })),
    timers: timers.map((timer) => ({ ...timer })),
    requests: [],
    loggedIn,
    password: FAKE_PASSWORD,
    needsSetup,
    googleConfigured,
    googleClientId,
    googleClientSecretSet,
    googleAccounts: googleAccounts.map((account) => ({ ...account })),
    googleCalendars: googleCalendars.map((calendar) => ({ ...calendar })),
    events: events.map((event) => ({ ...event })),
    eventFailures: eventFailures.map((failure) => ({ ...failure })),
    standupEntries: standupEntries.map((entry) => ({
      ...entry,
      bullets: entry.bullets.map((bullet) => ({ ...bullet })),
    })),
    standupYesterdaySuggestions: standupYesterdaySuggestions.map((suggestion) => ({
      ...suggestion,
    })),
    sprintGoal,
    standupEnabled,
    activeHours: { ...activeHours },
    assistAvailable,
    assistOllamaBaseUrl,
    assistModel,
    assistInstalledModels: [...assistInstalledModels],
    assistParseResult,
    assistParseFails,
    assistantAvailable,
    assistantBaseUrl,
    assistantModel,
    assistantApiKeySet,
    assistantPlanningPreferences,
    assistantChatQueue: [...assistantChatQueue],
  };

  const json = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  const page = (items: unknown[]): unknown => ({
    items,
    total: items.length,
    limit: 50,
    offset: 0,
  });

  const withoutAccountId = (
    calendar: FakeGoogleCalendar,
  ): Omit<FakeGoogleCalendar, "account_id"> => ({
    id: calendar.id,
    google_calendar_id: calendar.google_calendar_id,
    summary: calendar.summary,
    color: calendar.color,
    enabled: calendar.enabled,
  });

  const notFound = (message: string): Response =>
    json({ error: { code: "not_found", message } }, 404);

  const unauthorized = (): Response =>
    json({ error: { code: "unauthorized", message: "A valid session is required" } }, 401);

  const setupRequired = (): Response =>
    json({ error: { code: "setup_required", message: "Initial setup is required" } }, 401);

  /** Mirrors the backend's resolve_section rule: 404 unknown, 409 foreign. */
  const sectionMismatch = (sectionId: number, listId: number): Response | null => {
    const section = state.sections.find((s) => s.id === sectionId);
    if (!section) {
      return notFound(`Section ${sectionId} not found`);
    }
    if (section.list_id !== listId) {
      return json(
        {
          error: {
            code: "section_list_mismatch",
            message: `Section ${section.id} belongs to another list`,
          },
        },
        409,
      );
    }
    return null;
  };

  /** Mirror of the backend's day-window rule: days are read in each task's
   * own timezone (entryDayWindow implements exactly that reading). */
  const dayWindow = (task: FakeTask): [string, string] | null => entryDayWindow(task);

  const inSmartView = (task: FakeTask, view: string, today: string): boolean => {
    const window = dayWindow(task);
    if (window === null) {
      return false;
    }
    const [first, last] = window;
    if (view === "today") {
      return first <= today;
    }
    return first <= addDays(today, 6) && last >= today;
  };

  /** Mirror of the backend's completion rule: a recurring task advances in
   * place (occurrence recorded, dates shifted, checklist reset) and only
   * completes for real when its recurrence has ended. */
  const completeTask = (task: FakeTask): void => {
    if (task.recurrence !== null && task.due_date !== null) {
      const next = nextOccurrenceISO(task.recurrence, task.due_date, task.is_all_day);
      if (next !== null) {
        state.completedOccurrences.push({
          id: nextOccurrenceId++,
          task_id: task.id,
          title: task.title,
          list_id: task.list_id,
          completed_at: new Date().toISOString(),
          due_date: task.due_date,
          is_all_day: task.is_all_day,
        });
        const delta = new Date(next).getTime() - new Date(task.due_date).getTime();
        if (task.start_date !== null) {
          const shifted = new Date(new Date(task.start_date).getTime() + delta);
          task.start_date = `${shifted.toISOString().slice(0, 19)}Z`;
        }
        task.due_date = next;
        task.recurrence = decrementCount(task.recurrence);
        for (const item of task.check_items) {
          item.done = false;
        }
        return;
      }
    }
    task.completed = true;
    task.completed_at = new Date().toISOString();
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    state.requests.push({ method, url: url.pathname + url.search, body });

    if (method === "GET" && url.pathname === "/api/v1/auth/session") {
      if (state.needsSetup) {
        return setupRequired();
      }
      return state.loggedIn ? new Response(null, { status: 204 }) : unauthorized();
    }
    if (method === "GET" && url.pathname === "/api/v1/assist/status") {
      if (!state.loggedIn) {
        return unauthorized();
      }
      return json({ available: state.assistAvailable });
    }
    if (method === "GET" && url.pathname === "/api/v1/assist/config") {
      if (!state.loggedIn) {
        return unauthorized();
      }
      return json({
        ollama_base_url: state.assistOllamaBaseUrl,
        model: state.assistModel,
      });
    }
    if (method === "PUT" && url.pathname === "/api/v1/assist/config") {
      if (!state.loggedIn) {
        return unauthorized();
      }
      const input = body as { ollama_base_url?: string; model?: string };
      if (input.ollama_base_url !== undefined) {
        state.assistOllamaBaseUrl = input.ollama_base_url;
      }
      if (input.model !== undefined) {
        state.assistModel = input.model;
      }
      return json({
        ollama_base_url: state.assistOllamaBaseUrl,
        model: state.assistModel,
      });
    }
    if (method === "GET" && url.pathname === "/api/v1/assist/models") {
      if (!state.loggedIn) {
        return unauthorized();
      }
      return json({ models: state.assistInstalledModels });
    }
    if (method === "DELETE" && url.pathname === "/api/v1/assist/config") {
      if (!state.loggedIn) {
        return unauthorized();
      }
      state.assistOllamaBaseUrl = null;
      state.assistModel = null;
      return new Response(null, { status: 204 });
    }
    if (method === "POST" && url.pathname === "/api/v1/assist/parse-capture") {
      if (!state.loggedIn) {
        return unauthorized();
      }
      if (state.assistParseFails) {
        return json({ error: { code: "internal_error", message: "Assist parse failed" } }, 500);
      }
      const input = body as { text: string; local_date: string; time_zone: string };
      if (state.assistParseResult === null) {
        return json({
          title: input.text,
          due_date: null,
          is_all_day: false,
          time_zone: null,
          recurrence: null,
          reminders: [],
          list_name: null,
          tag_names: [],
          priority: null,
        });
      }
      return json(state.assistParseResult);
    }
    if (method === "GET" && url.pathname === "/api/v1/assistant/status") {
      if (!state.loggedIn) {
        return unauthorized();
      }
      return json({ available: state.assistantAvailable });
    }
    if (method === "GET" && url.pathname === "/api/v1/assistant/config") {
      if (!state.loggedIn) {
        return unauthorized();
      }
      return json({
        base_url: state.assistantBaseUrl,
        model: state.assistantModel,
        api_key_set: state.assistantApiKeySet,
        planning_preferences: state.assistantPlanningPreferences,
      });
    }
    if (method === "PUT" && url.pathname === "/api/v1/assistant/config") {
      if (!state.loggedIn) {
        return unauthorized();
      }
      const input = body as {
        base_url?: string;
        model?: string;
        api_key?: string;
        planning_preferences?: string;
      };
      if (input.base_url !== undefined) {
        state.assistantBaseUrl = input.base_url;
      }
      if (input.model !== undefined) {
        state.assistantModel = input.model;
      }
      if (input.api_key !== undefined) {
        state.assistantApiKeySet = true;
      }
      if (input.planning_preferences !== undefined) {
        state.assistantPlanningPreferences = input.planning_preferences;
      }
      return json({
        base_url: state.assistantBaseUrl,
        model: state.assistantModel,
        api_key_set: state.assistantApiKeySet,
        planning_preferences: state.assistantPlanningPreferences,
      });
    }
    if (method === "DELETE" && url.pathname === "/api/v1/assistant/config") {
      if (!state.loggedIn) {
        return unauthorized();
      }
      state.assistantBaseUrl = null;
      state.assistantModel = null;
      state.assistantApiKeySet = false;
      state.assistantPlanningPreferences = null;
      return new Response(null, { status: 204 });
    }
    if (method === "POST" && url.pathname === "/api/v1/assistant/chat") {
      if (!state.loggedIn) {
        return unauthorized();
      }
      const turn = state.assistantChatQueue.shift() ?? {
        message:
          "Sorry, I couldn't reach the planning assistant just now. Please try again in a moment.",
        suggestions: [],
        discarded_count: 0,
      };
      return json(turn);
    }
    if (method === "GET" && url.pathname === "/api/v1/google/status") {
      if (!state.loggedIn) {
        return unauthorized();
      }
      return json({
        configured: state.googleConfigured,
        client_id: state.googleClientId,
        client_secret_set: state.googleClientSecretSet,
      });
    }
    if (method === "PUT" && url.pathname === "/api/v1/google/credentials") {
      if (!state.loggedIn) {
        return unauthorized();
      }
      const input = body as { client_id: string; client_secret?: string | null };
      if (!input.client_id) {
        return json(
          { error: { code: "validation_error", message: "client_id must not be empty" } },
          422,
        );
      }
      if (!input.client_secret && !state.googleClientSecretSet) {
        return json(
          { error: { code: "client_secret_required", message: "A client secret is required" } },
          422,
        );
      }
      state.googleClientId = input.client_id;
      if (input.client_secret) {
        state.googleClientSecretSet = true;
      }
      state.googleConfigured = true;
      // Mirrors the backend: any credentials save flips every connected
      // account to needs_reconnect (issue #117) — a refresh token only
      // works for the OAuth client that minted it.
      for (const account of state.googleAccounts) {
        account.connection_state = "needs_reconnect";
      }
      return json({
        configured: true,
        client_id: state.googleClientId,
        client_secret_set: state.googleClientSecretSet,
      });
    }
    if (method === "DELETE" && url.pathname === "/api/v1/google/credentials") {
      if (!state.loggedIn) {
        return unauthorized();
      }
      state.googleConfigured = false;
      state.googleClientId = null;
      state.googleClientSecretSet = false;
      state.googleAccounts = [];
      state.googleCalendars = [];
      return new Response(null, { status: 204 });
    }
    if (method === "GET" && url.pathname === "/api/v1/google/accounts") {
      if (!state.loggedIn) {
        return unauthorized();
      }
      if (!state.googleConfigured) {
        return notFound("Google Calendar integration is not configured");
      }
      return json([...state.googleAccounts].sort((a, b) => a.id - b.id));
    }
    const googleAccountMatch = url.pathname.match(/^\/api\/v1\/google\/accounts\/(\d+)$/);
    if (googleAccountMatch && method === "DELETE") {
      if (!state.loggedIn) {
        return unauthorized();
      }
      if (!state.googleConfigured) {
        return notFound("Google Calendar integration is not configured");
      }
      const accountId = Number(googleAccountMatch[1]);
      if (!state.googleAccounts.some((account) => account.id === accountId)) {
        return notFound(`Google Account ${accountId} not found`);
      }
      state.googleAccounts = state.googleAccounts.filter((account) => account.id !== accountId);
      // A disconnected account's calendars go with it.
      state.googleCalendars = state.googleCalendars.filter(
        (calendar) => calendar.account_id !== accountId,
      );
      return new Response(null, { status: 204 });
    }
    const googleCalendarsMatch = url.pathname.match(
      /^\/api\/v1\/google\/accounts\/(\d+)\/calendars$/,
    );
    if (googleCalendarsMatch && method === "GET") {
      if (!state.loggedIn) {
        return unauthorized();
      }
      if (!state.googleConfigured) {
        return notFound("Google Calendar integration is not configured");
      }
      const accountId = Number(googleCalendarsMatch[1]);
      if (!state.googleAccounts.some((account) => account.id === accountId)) {
        return notFound(`Google Account ${accountId} not found`);
      }
      return json(
        state.googleCalendars
          .filter((calendar) => calendar.account_id === accountId)
          .sort((a, b) => a.id - b.id)
          .map(withoutAccountId),
      );
    }
    const googleCalendarsRefreshMatch = url.pathname.match(
      /^\/api\/v1\/google\/accounts\/(\d+)\/calendars\/refresh$/,
    );
    if (googleCalendarsRefreshMatch && method === "POST") {
      if (!state.loggedIn) {
        return unauthorized();
      }
      if (!state.googleConfigured) {
        return notFound("Google Calendar integration is not configured");
      }
      const accountId = Number(googleCalendarsRefreshMatch[1]);
      if (!state.googleAccounts.some((account) => account.id === accountId)) {
        return notFound(`Google Account ${accountId} not found`);
      }
      // Real backend re-reads Google here; the fake just returns whatever
      // the test has arranged in state.googleCalendars by this point,
      // exactly as if that read had happened.
      return json(
        state.googleCalendars
          .filter((calendar) => calendar.account_id === accountId)
          .sort((a, b) => a.id - b.id)
          .map(withoutAccountId),
      );
    }
    const googleCalendarMatch = url.pathname.match(
      /^\/api\/v1\/google\/accounts\/(\d+)\/calendars\/(\d+)$/,
    );
    if (googleCalendarMatch && method === "PATCH") {
      if (!state.loggedIn) {
        return unauthorized();
      }
      if (!state.googleConfigured) {
        return notFound("Google Calendar integration is not configured");
      }
      const accountId = Number(googleCalendarMatch[1]);
      const calendarId = Number(googleCalendarMatch[2]);
      const calendar = state.googleCalendars.find(
        (c) => c.id === calendarId && c.account_id === accountId,
      );
      if (!calendar) {
        return notFound(`Google Calendar ${calendarId} not found`);
      }
      const input = body as { enabled?: boolean; color?: string };
      if (input.enabled !== undefined) {
        calendar.enabled = input.enabled;
      }
      if (input.color !== undefined) {
        calendar.color = input.color;
      }
      return json(withoutAccountId(calendar));
    }
    if (method === "POST" && url.pathname === "/api/v1/auth/setup") {
      if (!state.needsSetup) {
        return notFound("Setup has already been completed");
      }
      state.needsSetup = false;
      state.loggedIn = true;
      return new Response(null, { status: 204 });
    }
    if (method === "POST" && url.pathname === "/api/v1/auth/login") {
      if (state.needsSetup) {
        return setupRequired();
      }
      const input = body as { password: string };
      if (input.password !== state.password) {
        return json({ error: { code: "invalid_credentials", message: "Incorrect password" } }, 401);
      }
      state.loggedIn = true;
      return new Response(null, { status: 204 });
    }
    if (state.needsSetup) {
      return setupRequired();
    }
    if (!state.loggedIn) {
      return unauthorized();
    }
    if (method === "POST" && url.pathname === "/api/v1/auth/logout") {
      state.loggedIn = false;
      return new Response(null, { status: 204 });
    }
    if (method === "POST" && url.pathname === "/api/v1/auth/password") {
      const input = body as { current_password: string; new_password: string };
      if (input.current_password !== state.password) {
        return json(
          { error: { code: "invalid_current_password", message: "Current password is incorrect" } },
          400,
        );
      }
      state.password = input.new_password;
      return new Response(null, { status: 204 });
    }

    if (method === "GET" && url.pathname === "/api/v1/lists") {
      const items = [...state.lists].sort(
        (a, b) =>
          Number(b.is_inbox) - Number(a.is_inbox) || a.sort_order - b.sort_order || a.id - b.id,
      );
      return json(page(items));
    }
    if (method === "POST" && url.pathname === "/api/v1/lists") {
      const input = body as { name: string; color?: string | null; emoji?: string | null };
      const created = fakeList(input.name, {
        color: input.color ?? null,
        emoji: input.emoji ?? null,
        sort_order: nextOrder(state.lists),
      });
      state.lists.push(created);
      return json(created, 201);
    }
    const listMatch = url.pathname.match(/^\/api\/v1\/lists\/(\d+)$/);
    if (listMatch) {
      const listId = Number(listMatch[1]);
      const list = state.lists.find((l) => l.id === listId);
      if (!list) {
        return notFound(`List ${listId} not found`);
      }
      if (method === "PATCH") {
        Object.assign(list, body);
        return json(list);
      }
      if (method === "DELETE") {
        state.lists = state.lists.filter((l) => l.id !== listId);
        state.tasks = state.tasks.filter((t) => t.list_id !== listId);
        state.completedOccurrences = state.completedOccurrences.filter(
          (occurrence) => occurrence.list_id !== listId,
        );
        return new Response(null, { status: 204 });
      }
    }
    if (method === "GET" && url.pathname === "/api/v1/folders") {
      const items = [...state.folders].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
      return json(page(items));
    }
    if (method === "POST" && url.pathname === "/api/v1/folders") {
      const created = fakeFolder((body as { name: string }).name, {
        sort_order: nextOrder(state.folders),
      });
      state.folders.push(created);
      return json(created, 201);
    }
    const folderMatch = url.pathname.match(/^\/api\/v1\/folders\/(\d+)$/);
    if (folderMatch) {
      const folderId = Number(folderMatch[1]);
      const folder = state.folders.find((f) => f.id === folderId);
      if (!folder) {
        return notFound(`Folder ${folderId} not found`);
      }
      if (method === "PATCH") {
        Object.assign(folder, body);
        return json(folder);
      }
      if (method === "DELETE") {
        for (const list of state.lists) {
          if (list.folder_id === folderId) {
            list.folder_id = null;
          }
        }
        state.folders = state.folders.filter((f) => f.id !== folderId);
        return new Response(null, { status: 204 });
      }
    }
    if (method === "GET" && url.pathname === "/api/v1/tasks") {
      const listId = url.searchParams.get("list_id");
      const tagId = url.searchParams.get("tag_id");
      const view = url.searchParams.get("view");
      const today = url.searchParams.get("today");
      const rangeStart = url.searchParams.get("range_start");
      const rangeEnd = url.searchParams.get("range_end");
      const scheduled = url.searchParams.get("scheduled");
      const search = url.searchParams.get("search");
      const priority = url.searchParams.get("priority");
      // Smart Lists are computed over open tasks only (mirrors the backend).
      const completed = view !== null ? "false" : url.searchParams.get("completed");
      let items = state.tasks.filter(
        (task) =>
          (listId === null || task.list_id === Number(listId)) &&
          (tagId === null || task.tags.some((tag) => tag.id === Number(tagId))) &&
          (completed === null || task.completed === (completed === "true")) &&
          (priority === null || task.priority === priority),
      );
      if (scheduled !== null && (view !== null || rangeStart !== null)) {
        return json(
          {
            error: {
              code: "validation_error",
              message: "the scheduled filter is exclusive with view and range filters",
            },
          },
          422,
        );
      }
      if (search !== null && (view !== null || rangeStart !== null || scheduled !== null)) {
        return json(
          {
            error: {
              code: "validation_error",
              message: "search is exclusive with view, range and scheduled filters",
            },
          },
          422,
        );
      }
      if (search !== null) {
        // Mirrors the backend: empty queries match nothing, others match
        // titles, descriptions and Check Item titles case-insensitively.
        const query = search.trim().toLowerCase();
        items =
          query === ""
            ? []
            : items.filter((task) =>
                [task.title, task.description, ...task.check_items.map((item) => item.title)].some(
                  (text) => text.toLowerCase().includes(query),
                ),
              );
      }
      if (scheduled !== null) {
        items = items.filter((task) => (task.due_date !== null) === (scheduled === "true"));
      }
      if (view === "today" || view === "next7") {
        if (today === null) {
          return json({ error: { code: "validation_error", message: "today is required" } }, 422);
        }
        items = items.filter((task) => inSmartView(task, view, today));
      }
      if ((rangeStart === null) !== (rangeEnd === null)) {
        return json(
          {
            error: { code: "validation_error", message: "range_start and range_end come together" },
          },
          422,
        );
      }
      if (rangeStart !== null && rangeEnd !== null) {
        if (rangeStart > rangeEnd) {
          return json(
            {
              error: {
                code: "validation_error",
                message: "range_start must not be after range_end",
              },
            },
            422,
          );
        }
        // Mirror the backend's calendar window: inclusive day intersection.
        items = items.filter((task) => {
          const window = dayWindow(task);
          return window !== null && window[0] <= rangeEnd && window[1] >= rangeStart;
        });
      }
      items =
        completed === "true"
          ? [...items].sort(
              (a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? "") || b.id - a.id,
            )
          : [...items].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
      return json(page(items));
    }
    if (method === "GET" && url.pathname === "/api/v1/events") {
      const rangeStart = url.searchParams.get("range_start");
      const rangeEnd = url.searchParams.get("range_end");
      if (rangeStart === null || rangeEnd === null) {
        return json(
          {
            error: { code: "validation_error", message: "range_start and range_end are required" },
          },
          422,
        );
      }
      if (rangeStart > rangeEnd) {
        return json(
          {
            error: {
              code: "validation_error",
              message: "range_start must not be after range_end",
            },
          },
          422,
        );
      }
      // Mirrors the backend: an Event already converted to a Task (issue
      // #111) is hidden — matched by the Task's own provenance columns,
      // since no Event storage exists for a flag to live on instead.
      const converted = new Set(
        state.tasks
          .filter((task) => task.source_google_calendar_id !== null)
          .map((task) => `${task.source_google_calendar_id}:${task.source_google_event_id}`),
      );
      const items = state.events.filter((event) => {
        if (converted.has(`${event.calendar_id}:${event.google_event_id}`)) {
          return false;
        }
        const window = entryDayWindow({ ...event, time_zone: null });
        return window !== null && window[0] <= rangeEnd && window[1] >= rangeStart;
      });
      return json({ events: items, failures: state.eventFailures });
    }
    if (method === "POST" && url.pathname === "/api/v1/tasks") {
      const input = body as {
        title: string;
        description?: string;
        list_id?: number;
        section_id?: number;
        priority?: Priority;
        tag_ids?: number[];
        start_date?: string;
        due_date?: string;
        is_all_day?: boolean;
        time_zone?: string;
        source_google_calendar_id?: number;
        source_google_event_id?: string;
      };
      const listId = input.list_id ?? INBOX.id;
      if (input.section_id !== undefined) {
        const rejection = sectionMismatch(input.section_id, listId);
        if (rejection) {
          return rejection;
        }
      }
      const tagIds = input.tag_ids ?? [];
      const missing = tagIds.find((id) => !state.tags.some((tag) => tag.id === id));
      if (missing !== undefined) {
        return notFound(`Tag ${missing} not found`);
      }
      const created = fakeTask(input.title, {
        description: input.description ?? "",
        list_id: listId,
        section_id: input.section_id ?? null,
        priority: input.priority ?? "none",
        start_date: input.start_date ?? null,
        due_date: input.due_date ?? null,
        is_all_day: input.is_all_day ?? false,
        time_zone: input.time_zone ?? null,
        source_google_calendar_id: input.source_google_calendar_id ?? null,
        source_google_event_id: input.source_google_event_id ?? null,
        tags: state.tags
          .filter((tag) => tagIds.includes(tag.id))
          .sort(byName)
          .map((tag) => ({ ...tag })),
        sort_order: nextOrder(state.tasks.filter((t) => t.list_id === listId)),
      });
      state.tasks.push(created);
      return json(created, 201);
    }
    if (method === "GET" && url.pathname === "/api/v1/completed-occurrences") {
      const listId = url.searchParams.get("list_id");
      const items = state.completedOccurrences
        .filter((occurrence) => listId === null || occurrence.list_id === Number(listId))
        .sort((a, b) => b.completed_at.localeCompare(a.completed_at) || b.id - a.id);
      return json(page(items));
    }
    if (method === "GET" && url.pathname === "/api/v1/sections") {
      const listId = url.searchParams.get("list_id");
      const items = state.sections
        .filter((section) => listId === null || section.list_id === Number(listId))
        .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
      return json(page(items));
    }
    if (method === "POST" && url.pathname === "/api/v1/sections") {
      const input = body as { list_id: number; name: string };
      const siblings = state.sections.filter((s) => s.list_id === input.list_id);
      const created = fakeSection(input.name, input.list_id, {
        sort_order: nextOrder(siblings),
      });
      state.sections.push(created);
      return json(created, 201);
    }
    const sectionMatch = url.pathname.match(/^\/api\/v1\/sections\/(\d+)$/);
    if (sectionMatch) {
      const sectionId = Number(sectionMatch[1]);
      const section = state.sections.find((s) => s.id === sectionId);
      if (!section) {
        return notFound(`Section ${sectionId} not found`);
      }
      if (method === "PATCH") {
        Object.assign(section, body);
        return json(section);
      }
      if (method === "DELETE") {
        state.sections = state.sections.filter((s) => s.id !== sectionId);
        for (const task of state.tasks) {
          if (task.section_id === sectionId) {
            task.section_id = null;
          }
        }
        return new Response(null, { status: 204 });
      }
    }
    if (method === "GET" && url.pathname === "/api/v1/tags") {
      const items = [...state.tags].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
      return json(page(items));
    }
    if (method === "POST" && url.pathname === "/api/v1/tags") {
      const input = body as { name: string; color?: string | null };
      if (state.tags.some((tag) => tag.name === input.name)) {
        return json(
          { error: { code: "tag_exists", message: `A tag named "${input.name}" already exists` } },
          409,
        );
      }
      const created = fakeTag(input.name, { color: input.color ?? null });
      state.tags.push(created);
      return json(created, 201);
    }
    const tagMatch = url.pathname.match(/^\/api\/v1\/tags\/(\d+)$/);
    if (tagMatch) {
      const tagId = Number(tagMatch[1]);
      const tag = state.tags.find((t) => t.id === tagId);
      if (!tag) {
        return notFound(`Tag ${tagId} not found`);
      }
      if (method === "PATCH") {
        const rename = (body as { name?: string }).name;
        if (rename !== undefined && state.tags.some((t) => t.id !== tagId && t.name === rename)) {
          return json(
            { error: { code: "tag_exists", message: `A tag named "${rename}" already exists` } },
            409,
          );
        }
        Object.assign(tag, body);
        // Mirror the backend: tasks reference the tag row, never a copy.
        for (const task of state.tasks) {
          task.tags = task.tags.map((t) => (t.id === tagId ? { ...tag } : t));
        }
        return json(tag);
      }
      if (method === "DELETE") {
        state.tags = state.tags.filter((t) => t.id !== tagId);
        for (const task of state.tasks) {
          task.tags = task.tags.filter((t) => t.id !== tagId);
        }
        return new Response(null, { status: 204 });
      }
    }
    const checkItemMatch = url.pathname.match(/^\/api\/v1\/tasks\/(\d+)\/check-items(?:\/(\d+))?$/);
    if (checkItemMatch) {
      const taskId = Number(checkItemMatch[1]);
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task) {
        return notFound(`Task ${taskId} not found`);
      }
      if (method === "POST" && checkItemMatch[2] === undefined) {
        const created = fakeCheckItem((body as { title: string }).title, {
          sort_order: nextOrder(task.check_items),
        });
        task.check_items.push(created);
        return json(task, 201);
      }
      const itemId = Number(checkItemMatch[2]);
      const item = task.check_items.find((i) => i.id === itemId);
      if (!item) {
        return notFound(`Check item ${itemId} not found on task ${taskId}`);
      }
      if (method === "PATCH") {
        Object.assign(item, body);
        // Mirror the backend rule: ticking the last open item completes the
        // parent — which advances a recurring parent in place instead.
        if ((body as { done?: boolean }).done === true && task.check_items.every((i) => i.done)) {
          completeTask(task);
        }
        task.check_items.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
        return json(task);
      }
      if (method === "DELETE") {
        task.check_items = task.check_items.filter((i) => i.id !== itemId);
        return new Response(null, { status: 204 });
      }
    }
    const taskMatch = url.pathname.match(/^\/api\/v1\/tasks\/(\d+)$/);
    if (taskMatch) {
      const taskId = Number(taskMatch[1]);
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task) {
        return notFound(`Task ${taskId} not found`);
      }
      if (method === "PATCH") {
        const { tag_ids, completed, ...rest } = body as {
          tag_ids?: number[];
          completed?: boolean;
        } & Record<string, unknown>;
        // Mirror the backend's reminder rules: no dateless Reminders, set
        // semantics, and clearing the date sweeps the Reminders with it.
        const effectiveDue = rest.due_date !== undefined ? rest.due_date : task.due_date;
        if (Array.isArray(rest.reminders)) {
          if (rest.reminders.length > 0 && effectiveDue === null) {
            return json(
              {
                error: {
                  code: "invalid_reminders",
                  message: "A task without a date cannot hold Reminders",
                },
              },
              422,
            );
          }
          rest.reminders = [...new Set(rest.reminders as string[])];
        } else if (effectiveDue === null && task.reminders.length > 0) {
          rest.reminders = [];
        }
        // Mirror the backend's recurrence rules: a dateless task cannot recur,
        // and clearing the date sweeps the recurrence with it.
        if (typeof rest.recurrence === "string" && effectiveDue === null) {
          return json(
            {
              error: {
                code: "invalid_recurrence",
                message: "A task without a date cannot recur",
              },
            },
            422,
          );
        }
        if (!("recurrence" in rest) && effectiveDue === null && task.recurrence !== null) {
          rest.recurrence = null;
        }
        if (
          typeof rest.list_id === "number" &&
          rest.list_id !== task.list_id &&
          rest.section_id === undefined
        ) {
          rest.section_id = null;
        }
        if (typeof rest.section_id === "number") {
          const targetList = typeof rest.list_id === "number" ? rest.list_id : task.list_id;
          const rejection = sectionMismatch(rest.section_id, targetList);
          if (rejection) {
            return rejection;
          }
        }
        Object.assign(task, rest);
        if (tag_ids !== undefined) {
          const missing = tag_ids.find((id) => !state.tags.some((tag) => tag.id === id));
          if (missing !== undefined) {
            return notFound(`Tag ${missing} not found`);
          }
          task.tags = state.tags
            .filter((tag) => tag_ids.includes(tag.id))
            .sort(byName)
            .map((tag) => ({ ...tag }));
        }
        // Completion last, against the task the patch produced (mirrors the
        // backend): completing a recurring task advances it in place.
        if (typeof completed === "boolean" && completed !== task.completed) {
          if (completed) {
            completeTask(task);
          } else {
            task.completed = false;
            task.completed_at = null;
          }
        }
        return json(task);
      }
      if (method === "DELETE") {
        state.tasks = state.tasks.filter((t) => t.id !== taskId);
        state.completedOccurrences = state.completedOccurrences.filter(
          (occurrence) => occurrence.task_id !== taskId,
        );
        // Mirror the backend: Focus Sessions and Timer presets outlive the
        // Task, only the link goes.
        for (const focusSession of state.focusSessions) {
          if (focusSession.task_id === taskId) {
            focusSession.task_id = null;
          }
        }
        for (const timer of state.timers) {
          if (timer.task_id === taskId) {
            timer.task_id = null;
          }
        }
        return new Response(null, { status: 204 });
      }
    }
    if (method === "GET" && url.pathname === "/api/v1/habits") {
      const due = url.searchParams.get("due");
      // Mirror the backend's due filter: daily and N-times-per-week habits
      // are due every day; weekday habits only on their days. Archived
      // Habits leave the today screen.
      const items = state.habits.filter(
        (habit) => due === null || (!habit.is_archived && habitDueOn(habit.frequency, due)),
      );
      return json(page(items));
    }
    if (method === "POST" && url.pathname === "/api/v1/habits") {
      const input = body as { name: string } & Partial<Omit<FakeHabit, "id" | "name">>;
      const created = fakeHabit(input.name, input);
      state.habits.push(created);
      return json(created, 201);
    }
    const habitMatch = url.pathname.match(/^\/api\/v1\/habits\/(\d+)$/);
    if (habitMatch) {
      const habitId = Number(habitMatch[1]);
      const habit = state.habits.find((h) => h.id === habitId);
      if (!habit) {
        return notFound(`Habit ${habitId} not found`);
      }
      if (method === "PATCH") {
        // Mirror the backend: becoming Numeric requires a goal in the same
        // request, and becoming Boolean sweeps the goal fields back.
        const patch = body as { type?: HabitType; goal?: number };
        if (patch.type === "numeric" && habit.type === "boolean" && patch.goal === undefined) {
          return json(
            {
              error: { code: "invalid_habit", message: "A Numeric habit requires a goal" },
            },
            422,
          );
        }
        Object.assign(habit, body);
        if (habit.type === "boolean") {
          Object.assign(habit, { goal: 1, step: 1, unit: null });
        }
        return json(habit);
      }
      if (method === "DELETE") {
        state.habits = state.habits.filter((h) => h.id !== habitId);
        state.checkIns = state.checkIns.filter((c) => c.habit_id !== habitId);
        // Mirror the backend: Focus Sessions and Timer presets outlive the
        // Habit, only the link goes.
        for (const focusSession of state.focusSessions) {
          if (focusSession.habit_id === habitId) {
            focusSession.habit_id = null;
          }
        }
        for (const timer of state.timers) {
          if (timer.habit_id === habitId) {
            timer.habit_id = null;
          }
        }
        return new Response(null, { status: 204 });
      }
    }
    const statsMatch = url.pathname.match(/^\/api\/v1\/habits\/(\d+)\/stats$/);
    if (statsMatch && method === "GET") {
      const habitId = Number(statsMatch[1]);
      const habit = state.habits.find((h) => h.id === habitId);
      if (!habit) {
        return notFound(`Habit ${habitId} not found`);
      }
      const today = url.searchParams.get("today");
      if (today === null) {
        return json({ error: { code: "validation_error", message: "today is required" } }, 422);
      }
      const year = url.searchParams.get("year") ?? today.slice(0, 4);
      const habitCheckIns = state.checkIns.filter((checkIn) => checkIn.habit_id === habitId);
      const checked = new Set(habitCheckIns.map((checkIn) => checkIn.date));
      // Mirror the backend's streak rule: consecutive scheduled days checked
      // in, walking back from today — a missed scheduled day resets it,
      // unscheduled days are skipped, and an unticked today is graced.
      let streak = 0;
      if (checked.size > 0) {
        let day = today;
        if (habitDueOn(habit.frequency, day) && !checked.has(day)) {
          day = addDays(day, -1);
        }
        const earliest = [...checked].sort()[0] as string;
        while (day >= earliest) {
          if (habitDueOn(habit.frequency, day)) {
            if (!checked.has(day)) {
              break;
            }
            streak += 1;
          }
          day = addDays(day, -1);
        }
      }
      const heatmap = habitCheckIns
        .filter((checkIn) => checkIn.date.slice(0, 4) === year)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((checkIn) => ({
          date: checkIn.date,
          value: checkIn.value,
          intensity: Math.min(checkIn.value / habit.goal, 1),
        }));
      return json({ streak, heatmap });
    }
    const checkInMatch = url.pathname.match(
      /^\/api\/v1\/habits\/(\d+)\/check-ins\/(\d{4}-\d{2}-\d{2})$/,
    );
    if (checkInMatch) {
      const habitId = Number(checkInMatch[1]);
      const day = checkInMatch[2] as string;
      if (!state.habits.some((h) => h.id === habitId)) {
        return notFound(`Habit ${habitId} not found`);
      }
      const existing = state.checkIns.find((c) => c.habit_id === habitId && c.date === day);
      if (method === "PUT") {
        // Mirror the backend's upsert: one row per (habit, date), whatever
        // the tap count — PUT replaces the day's whole value.
        const value = (body as { value?: number }).value ?? 1;
        if (existing) {
          existing.value = value;
          return json(existing);
        }
        const created: FakeCheckIn = { id: nextCheckInId++, habit_id: habitId, date: day, value };
        state.checkIns.push(created);
        return json(created);
      }
      if (method === "DELETE") {
        if (!existing) {
          return notFound(`No check-in on ${day} for habit ${habitId}`);
        }
        state.checkIns = state.checkIns.filter((c) => c !== existing);
        return new Response(null, { status: 204 });
      }
    }
    if (method === "GET" && url.pathname === "/api/v1/check-ins") {
      const day = url.searchParams.get("date");
      const habitId = url.searchParams.get("habit_id");
      const items = state.checkIns
        .filter(
          (checkIn) =>
            (day === null || checkIn.date === day) &&
            (habitId === null || checkIn.habit_id === Number(habitId)),
        )
        .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
      return json(page(items));
    }
    const spanSeconds = (s: { started_at: string; ended_at: string }): number =>
      (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 1000;

    /** Mirror the backend's period and link rules for Focus Sessions. */
    const sessionRejection = (candidate: FakeFocusSession): Response | null => {
      if (spanSeconds(candidate) <= 0) {
        return json(
          { error: { code: "invalid_session", message: "The end must follow the start" } },
          422,
        );
      }
      if (candidate.pause_seconds >= spanSeconds(candidate)) {
        return json(
          {
            error: {
              code: "invalid_session",
              message: "The pause cannot consume the whole session",
            },
          },
          422,
        );
      }
      if (candidate.task_id !== null && candidate.habit_id !== null) {
        return json(
          {
            error: {
              code: "invalid_session",
              message: "A session links to a Task or a Habit, never both",
            },
          },
          422,
        );
      }
      if (candidate.task_id !== null && !state.tasks.some((t) => t.id === candidate.task_id)) {
        return notFound(`Task ${candidate.task_id} not found`);
      }
      if (candidate.habit_id !== null && !state.habits.some((h) => h.id === candidate.habit_id)) {
        return notFound(`Habit ${candidate.habit_id} not found`);
      }
      return null;
    };

    const withDuration = (s: FakeFocusSession): unknown => ({
      ...s,
      duration_seconds: Math.round(spanSeconds(s)) - s.pause_seconds,
    });

    if (method === "GET" && url.pathname === "/api/v1/focus-sessions") {
      const items = [...state.focusSessions]
        .sort((a, b) => b.started_at.localeCompare(a.started_at) || b.id - a.id)
        .map(withDuration);
      return json(page(items));
    }
    if (method === "POST" && url.pathname === "/api/v1/focus-sessions") {
      const input = body as Partial<FakeFocusSession> & {
        mode: "pomo" | "stopwatch";
        started_at: string;
        ended_at: string;
      };
      const created = fakeFocusSession({
        mode: input.mode,
        task_id: input.task_id ?? null,
        habit_id: input.habit_id ?? null,
        started_at: input.started_at,
        ended_at: input.ended_at,
        pause_seconds: input.pause_seconds ?? 0,
        note: input.note ?? "",
        created_at: new Date().toISOString(),
      });
      const rejection = sessionRejection(created);
      if (rejection) {
        return rejection;
      }
      state.focusSessions.push(created);
      return json(withDuration(created), 201);
    }
    const focusSessionMatch = url.pathname.match(/^\/api\/v1\/focus-sessions\/(\d+)$/);
    if (focusSessionMatch) {
      const sessionId = Number(focusSessionMatch[1]);
      const focusSession = state.focusSessions.find((s) => s.id === sessionId);
      if (!focusSession) {
        return notFound(`Focus session ${sessionId} not found`);
      }
      if (method === "PATCH") {
        const patch = body as Partial<FakeFocusSession>;
        const candidate = { ...focusSession, ...patch };
        // Mirror the backend: linking one side replaces the other.
        if (candidate.task_id !== null && candidate.habit_id !== null) {
          if ("task_id" in patch && !("habit_id" in patch)) {
            candidate.habit_id = null;
          } else if ("habit_id" in patch && !("task_id" in patch)) {
            candidate.task_id = null;
          }
        }
        const rejection = sessionRejection(candidate);
        if (rejection) {
          return rejection;
        }
        Object.assign(focusSession, candidate);
        return json(withDuration(focusSession));
      }
      if (method === "DELETE") {
        state.focusSessions = state.focusSessions.filter((s) => s.id !== sessionId);
        return new Response(null, { status: 204 });
      }
    }
    if (method === "GET" && url.pathname === "/api/v1/timers") {
      const items = [...state.timers].sort((a, b) => a.id - b.id);
      return json(page(items));
    }
    if (method === "POST" && url.pathname === "/api/v1/timers") {
      const input = body as Partial<FakeTimer> & { name: string; mode: "pomo" | "stopwatch" };
      // Mirror the backend: a Pomo preset needs a duration, a Stopwatch none.
      const duration = input.duration_seconds ?? null;
      if ((input.mode === "pomo") !== (duration !== null)) {
        return json(
          { error: { code: "invalid_timer", message: "A Timer's duration must match its mode" } },
          422,
        );
      }
      const created = fakeTimer(input.name, {
        mode: input.mode,
        duration_seconds: duration,
        task_id: input.task_id ?? null,
        habit_id: input.habit_id ?? null,
      });
      state.timers.push(created);
      return json(created, 201);
    }
    const timerMatch = url.pathname.match(/^\/api\/v1\/timers\/(\d+)$/);
    if (timerMatch) {
      const timerId = Number(timerMatch[1]);
      const timer = state.timers.find((t) => t.id === timerId);
      if (!timer) {
        return notFound(`Timer ${timerId} not found`);
      }
      if (method === "PATCH") {
        const patch = body as Partial<FakeTimer>;
        const candidate = { ...timer, ...patch };
        // Mirror the backend: linking one side replaces the other.
        if (candidate.task_id !== null && candidate.habit_id !== null) {
          if ("task_id" in patch && !("habit_id" in patch)) {
            candidate.habit_id = null;
          } else if ("habit_id" in patch && !("task_id" in patch)) {
            candidate.task_id = null;
          }
        }
        if ((candidate.mode === "pomo") !== (candidate.duration_seconds !== null)) {
          return json(
            { error: { code: "invalid_timer", message: "A Timer's duration must match its mode" } },
            422,
          );
        }
        Object.assign(timer, candidate);
        return json(timer);
      }
      if (method === "DELETE") {
        state.timers = state.timers.filter((t) => t.id !== timerId);
        return new Response(null, { status: 204 });
      }
    }
    if (method === "GET" && url.pathname === "/api/v1/focus-stats") {
      const start = url.searchParams.get("start");
      const end = url.searchParams.get("end");
      if (start === null || end === null || start > end) {
        return json({ error: { code: "validation_error", message: "bad range" } }, 422);
      }
      // Mirror the backend: a session counts toward the local day it started
      // (the UI always sends the browser timezone), totals are span - pause,
      // and weeks start on Monday.
      const focusSeconds = (s: FakeFocusSession): number =>
        Math.round((new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 1000) -
        s.pause_seconds;
      const pad = (n: number): string => String(n).padStart(2, "0");
      const dayIso = (d: Date): string =>
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const dayOf = (s: FakeFocusSession): string => dayIso(new Date(s.started_at));
      const mondayOf = (day: string): string => {
        const [y = 0, m = 1, dd = 1] = day.split("-").map(Number);
        const d = new Date(y, m - 1, dd);
        d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        return dayIso(d);
      };
      const inRange = state.focusSessions
        .map((s) => ({ s, day: dayOf(s) }))
        .filter(({ day }) => start <= day && day <= end);
      const sum = (map: Map<string, number>, key: string, seconds: number): void => {
        map.set(key, (map.get(key) ?? 0) + seconds);
      };
      const days = new Map<string, number>();
      const weeks = new Map<string, number>();
      const byTask = new Map<string, number>();
      const byHabit = new Map<string, number>();
      for (const { s, day } of inRange) {
        sum(days, day, focusSeconds(s));
        sum(weeks, mondayOf(day), focusSeconds(s));
        if (s.task_id !== null) {
          sum(byTask, String(s.task_id), focusSeconds(s));
        }
        if (s.habit_id !== null) {
          sum(byHabit, String(s.habit_id), focusSeconds(s));
        }
      }
      const sorted = (map: Map<string, number>): [string, number][] =>
        [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      return json({
        days: sorted(days).map(([date, seconds]) => ({ date, seconds })),
        weeks: sorted(weeks).map(([weekStart, seconds]) => ({ start: weekStart, seconds })),
        tasks: [...byTask.entries()].map(([id, seconds]) => ({
          task_id: Number(id),
          title: state.tasks.find((t) => t.id === Number(id))?.title ?? "",
          seconds,
        })),
        habits: [...byHabit.entries()].map(([id, seconds]) => ({
          habit_id: Number(id),
          name: state.habits.find((h) => h.id === Number(id))?.name ?? "",
          seconds,
        })),
      });
    }
    if (url.pathname === "/api/v1/settings/stand-up") {
      if (method === "GET") {
        return json({ enabled: state.standupEnabled });
      }
      if (method === "PUT") {
        const input = body as { enabled: boolean };
        state.standupEnabled = input.enabled;
        return json({ enabled: state.standupEnabled });
      }
    }
    if (url.pathname === "/api/v1/settings/active-hours") {
      if (method === "GET") {
        return json({ ...state.activeHours });
      }
      if (method === "PUT") {
        const input = body as { enabled: boolean; start: string; end: string };
        const toMinutes = (label: string): number =>
          Number(label.slice(0, 2)) * 60 + Number(label.slice(3));
        const aligned = (label: string): boolean =>
          /^\d\d:\d\d$/.test(label) && toMinutes(label) % 30 === 0;
        if (
          !aligned(input.start) ||
          !aligned(input.end) ||
          toMinutes(input.start) >= toMinutes(input.end)
        ) {
          return json(
            { error: { code: "validation_error", message: "invalid active hours band" } },
            422,
          );
        }
        state.activeHours = {
          enabled: input.enabled,
          start: input.start,
          end: input.end,
        };
        return json({ ...state.activeHours });
      }
    }
    if (method === "GET" && url.pathname === "/api/v1/stand-up/suggestions/today") {
      const today = url.searchParams.get("date");
      if (today === null) {
        return json({ error: { code: "validation_error", message: "date is required" } }, 422);
      }
      // Mirrors the backend: the Today Smart List's own query (open Tasks
      // whose scheduled window has started by `today`), reduced to a
      // read-only chip shape.
      const items = state.tasks
        .filter((task) => !task.completed && inSmartView(task, "today", today))
        .map((task) => ({ task_id: task.id, title: task.title }));
      return json(items);
    }
    if (url.pathname === "/api/v1/stand-up/sprint-goal") {
      if (method === "GET") {
        return json({ text: state.sprintGoal });
      }
      if (method === "PUT") {
        const input = body as { text: string };
        state.sprintGoal = input.text;
        return json({ text: state.sprintGoal });
      }
    }
    if (method === "GET" && url.pathname === "/api/v1/stand-up/suggestions/yesterday") {
      return json(state.standupYesterdaySuggestions);
    }
    if (method === "GET" && url.pathname === "/api/v1/stand-up/entries") {
      const items = [...state.standupEntries]
        .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
        .map(({ id, date, sprint_goal_snapshot }) => ({ id, date, sprint_goal_snapshot }));
      return json(page(items));
    }
    const standupEntryMatch = url.pathname.match(
      /^\/api\/v1\/stand-up\/entries\/(\d{4}-\d{2}-\d{2})$/,
    );
    if (standupEntryMatch) {
      const day = standupEntryMatch[1] as string;
      const entry = state.standupEntries.find((e) => e.date === day);
      if (method === "GET") {
        if (!entry) {
          return notFound(`No stand-up entry on ${day}`);
        }
        return json(entry);
      }
      if (method === "DELETE") {
        if (!entry) {
          return notFound(`No stand-up entry on ${day}`);
        }
        state.standupEntries = state.standupEntries.filter((e) => e !== entry);
        return new Response(null, { status: 204 });
      }
    }
    const standupBulletsMatch = url.pathname.match(
      /^\/api\/v1\/stand-up\/entries\/(\d{4}-\d{2}-\d{2})\/bullets$/,
    );
    if (standupBulletsMatch && method === "POST") {
      const day = standupBulletsMatch[1] as string;
      let entry = state.standupEntries.find((e) => e.date === day);
      if (!entry) {
        entry = fakeStandupEntry(day, { sprint_goal_snapshot: state.sprintGoal });
        state.standupEntries.push(entry);
      }
      const input = body as { section: StandupSection; text: string };
      const siblings = entry.bullets.filter((b) => b.section === input.section);
      const created: FakeStandupBullet = {
        id: nextStandupBulletId++,
        section: input.section,
        text: input.text,
        sort_order: nextOrder(siblings),
      };
      entry.bullets.push(created);
      entry.bullets.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
      return json(entry, 201);
    }
    const standupBulletMatch = url.pathname.match(
      /^\/api\/v1\/stand-up\/entries\/(\d{4}-\d{2}-\d{2})\/bullets\/(\d+)$/,
    );
    if (standupBulletMatch) {
      const day = standupBulletMatch[1] as string;
      const bulletId = Number(standupBulletMatch[2]);
      const entry = state.standupEntries.find((e) => e.date === day);
      if (!entry) {
        return notFound(`No stand-up entry on ${day}`);
      }
      const bullet = entry.bullets.find((b) => b.id === bulletId);
      if (!bullet) {
        return notFound(`Bullet ${bulletId} not found on stand-up entry ${entry.id}`);
      }
      if (method === "PATCH") {
        Object.assign(bullet, body);
        entry.bullets.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
        return json(entry);
      }
      if (method === "DELETE") {
        entry.bullets = entry.bullets.filter((b) => b.id !== bulletId);
        return new Response(null, { status: 204 });
      }
    }
    return notFound(`No route: ${method} ${url.pathname}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return state;
}
