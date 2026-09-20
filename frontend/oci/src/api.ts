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
  /** Provenance of a Task converted from a Google Event (issue #111): the
   * calendar row id and Google's own event id it came from. Both null for
   * an ordinary Task. */
  source_google_calendar_id: number | null;
  source_google_event_id: string | null;
  /** The Key Result this Task's completion counts toward, if any (ADR 0012). */
  key_result_id: number | null;
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
const SETUP_PATH = "/api/v1/auth/setup";
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
    if (
      response.status === 401 &&
      path !== LOGIN_PATH &&
      path !== SETUP_PATH &&
      path !== SESSION_PATH
    ) {
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

/** Sets the initial password on a fresh deployment and logs in with it —
 * reachable only until a password exists (checkSession's "setup_required"
 * error code is what routes the gate here in the first place). */
export function setup(password: string): Promise<void> {
  return request(SETUP_PATH, { method: "POST", body: JSON.stringify({ password }) });
}

/** Clears the session cookie server-side. The cookie is httpOnly, so this is
 * the only way to end a session — client-side code can't delete it itself. */
export function logout(): Promise<void> {
  return request(LOGOUT_PATH, { method: "POST" });
}

/** Changes the password and rotates the session signing key server-side
 * (ADR 0008), which invalidates every other device's cookie. The response
 * re-issues a fresh cookie for this device, so the caller stays logged in —
 * nothing else to do here on success. A wrong current password rejects with
 * `invalid_current_password` at 400, not 401, so it isn't mistaken for a
 * lapsed session by the global onUnauthorized listener. */
export function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return request("/api/v1/auth/password", {
    method: "POST",
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
}

/** Whether Assist (ADR 0005) is available: Ollama is reachable and the
 * configured model is installed. Polled on load and on window refocus;
 * `available: false` — unset settings, an unreachable Ollama, or a missing
 * model all collapse to this same value — means no AI affordance renders
 * anywhere, and Quick-Add behaves exactly as it does today. */
export interface AssistStatus {
  available: boolean;
}

export function fetchAssistStatus(): Promise<AssistStatus> {
  return request("/api/v1/assist/status");
}

/** Assisted Capture's proposed draft (ADR 0005; issue #43): the residual
 * title plus a resolved date, or a fallback draft with `due_date: null`
 * when nothing could be extracted — same shape either way, so the caller
 * never has to branch on which happened. `time_zone` is set only alongside
 * a non-null `due_date`. */
export interface AssistCaptureDraft {
  title: string;
  due_date: string | null;
  is_all_day: boolean;
  time_zone: string | null;
  /** RRULE content and reminder offsets resolved from recurrence/reminder
   * phrases (issue #44) — same wire conventions as Task.recurrence and
   * Task.reminders. Both are only ever set alongside a non-null due_date;
   * a dateless draft can't recur or hold reminders. */
  recurrence: string | null;
  reminders: string[];
  /** A matched existing List name, matched existing Tag names, and a
   * resolved Priority level (issue #45) — none require a non-null
   * due_date, since filing a Task is independent of scheduling it. Always
   * one of the `list_names`/`tag_names` candidates the request sent, never
   * an invented name. */
  list_name: string | null;
  tag_names: string[];
  priority: Priority | null;
}

/** One parse of free text into a proposed Task draft. `local_date` (the
 * caller's own YYYY-MM-DD day) and `time_zone` (IANA key) are what a
 * relative phrase like "tomorrow" resolves against — resolution itself
 * happens server-side, in code, never in the model. `list_names`/
 * `tag_names` are the caller's existing List/Tag names (issue #45) — the
 * only legal values a returned `list_name`/`tag_names` match can name. */
export function parseAssistCapture(
  input: {
    text: string;
    local_date: string;
    time_zone: string;
    list_names: string[];
    tag_names: string[];
  },
  signal?: AbortSignal,
): Promise<AssistCaptureDraft> {
  return request("/api/v1/assist/parse-capture", {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  });
}

/** The Ollama base URL and model name Settings configures Assist with
 * (ADR 0005). Neither is a credential, so — unlike GoogleStatus's client
 * secret — both round-trip in full; there's nothing to mask. */
export interface AssistConfig {
  ollama_base_url: string | null;
  model: string | null;
}

export function fetchAssistConfig(): Promise<AssistConfig> {
  return request("/api/v1/assist/config");
}

/** Saves whichever fields are passed; an omitted field is left unchanged
 * server-side (the same partial-update convention as saveGoogleCredentials'
 * client secret). */
export function saveAssistConfig(
  fields: Partial<{ ollamaBaseUrl: string; model: string }>,
): Promise<AssistConfig> {
  const body: { ollama_base_url?: string; model?: string } = {};
  if (fields.ollamaBaseUrl !== undefined) {
    body.ollama_base_url = fields.ollamaBaseUrl;
  }
  if (fields.model !== undefined) {
    body.model = fields.model;
  }
  return request("/api/v1/assist/config", { method: "PUT", body: JSON.stringify(body) });
}

/** Clears both settings, returning Assist to the same unconfigured,
 * invisible state as a fresh deployment. */
export function removeAssistConfig(): Promise<void> {
  return request("/api/v1/assist/config", { method: "DELETE" });
}

/** Every model Ollama reports installed at `ollamaBaseUrl` — the Settings
 * model dropdown's source. Queries that URL directly (not the saved
 * setting), so it works against a base URL just typed but not yet saved;
 * omit it to fall back to whatever's currently saved. Never rejects on an
 * unreachable Ollama — an empty list either way, so the caller doesn't
 * need a separate error path from "nothing installed". */
export function fetchAssistModels(ollamaBaseUrl?: string): Promise<{ models: string[] }> {
  const query = ollamaBaseUrl === undefined ? "" : `?base_url=${encodeURIComponent(ollamaBaseUrl)}`;
  return request(`/api/v1/assist/models${query}`);
}

/** Whether the Assistant (ADR 0009) is available: the configured provider
 * is reachable and authenticated. Polled on load and on window refocus;
 * `available: false` — unset settings, an unreachable provider, or a bad
 * API key all collapse to this same value — means no Assistant affordance
 * renders anywhere. Entirely independent of AssistStatus above. */
export interface AssistantStatus {
  available: boolean;
}

export function fetchAssistantStatus(): Promise<AssistantStatus> {
  return request("/api/v1/assistant/status");
}

/** The Assistant's provider config Settings reads/writes (ADR 0009). Unlike
 * AssistConfig, the API key is a credential — write-only, so only whether
 * one is stored round-trips, never its value, exactly as GoogleStatus's
 * client secret. */
export interface AssistantConfig {
  base_url: string | null;
  model: string | null;
  api_key_set: boolean;
  planning_preferences: string | null;
}

export function fetchAssistantConfig(): Promise<AssistantConfig> {
  return request("/api/v1/assistant/config");
}

/** Saves whichever fields are passed; an omitted field is left unchanged
 * server-side. `apiKey` is omitted (not sent empty) to keep whatever is
 * already stored — the same write-only convention as
 * `saveGoogleCredentials`'s `clientSecret`. */
export function saveAssistantConfig(
  fields: Partial<{
    baseUrl: string;
    model: string;
    apiKey: string;
    planningPreferences: string;
  }>,
): Promise<AssistantConfig> {
  const body: {
    base_url?: string;
    model?: string;
    api_key?: string;
    planning_preferences?: string;
  } = {};
  if (fields.baseUrl !== undefined) {
    body.base_url = fields.baseUrl;
  }
  if (fields.model !== undefined) {
    body.model = fields.model;
  }
  if (fields.apiKey !== undefined) {
    body.api_key = fields.apiKey;
  }
  if (fields.planningPreferences !== undefined) {
    body.planning_preferences = fields.planningPreferences;
  }
  return request("/api/v1/assistant/config", { method: "PUT", body: JSON.stringify(body) });
}

/** Clears every field, returning the Assistant to the same unconfigured,
 * invisible state as a fresh deployment. */
export function removeAssistantConfig(): Promise<void> {
  return request("/api/v1/assistant/config", { method: "DELETE" });
}

/** One turn of the Assistant's chat transcript (ADR 0009). The whole
 * transcript is held client-side and posted in full each turn — nothing
 * about the conversation is persisted server-side. */
export interface AssistantChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** The Assistant's write vocabulary (ADR 0009, issue #187): the only
 * shapes a Suggestion can take. Every field a given `type` doesn't use is
 * simply absent — this mirrors the backend's discriminated union, not its
 * wire schema (which sends every field on every suggestion). */
export type AssistantSuggestion =
  | {
      type: "create_task";
      title: string;
      list_name: string | null;
      tag_names: string[];
      priority: Priority;
      start_date: string | null;
      due_date: string | null;
      is_all_day: boolean;
      time_zone: string | null;
    }
  | {
      type: "schedule_task" | "reschedule_task";
      task_id: number;
      start_date: string | null;
      due_date: string | null;
      is_all_day: boolean;
      time_zone: string | null;
    }
  | { type: "complete_task"; task_id: number }
  | { type: "set_priority"; task_id: number; priority: Priority }
  | { type: "set_list"; task_id: number; list_name: string }
  | { type: "add_tags"; task_id: number; tag_names: string[] }
  | { type: "add_check_items"; task_id: number; check_item_titles: string[] };

/** One chat turn's response: prose plus zero or more validated
 * Suggestions, and how many the backend discarded (malformed, or naming
 * something outside the snapshot) before they ever reached here. */
export interface AssistantChatTurn {
  message: string;
  suggestions: AssistantSuggestion[];
  discarded_count: number;
}

/** Posts the whole transcript (including the just-typed turn) plus the
 * caller's own day/timezone, which is what a relative phrase like "this
 * afternoon" resolves against server-side. Never rejects on a provider
 * failure or timeout — those degrade to an apologetic `message` with no
 * Suggestions (ADR 0009) — only a genuine network failure throws. */
export function postAssistantChat(input: {
  transcript: AssistantChatMessage[];
  local_date: string;
  time_zone: string;
}): Promise<AssistantChatTurn> {
  return request("/api/v1/assistant/chat", { method: "POST", body: JSON.stringify(input) });
}

export interface GoogleStatus {
  configured: boolean;
  /** The client ID isn't sensitive — Settings shows it back for editing. */
  client_id: string | null;
  /** Whether a client secret is stored; the value itself never round-trips. */
  client_secret_set: boolean;
}

/** Whether the Google Calendar integration is configured server-side (the
 * two settings present) — the client secret's value never included. Settings
 * asks this once to decide whether to show the account-connect UI; when
 * `configured` is false, no Google wording appears anywhere else in the app. */
export function fetchGoogleStatus(): Promise<GoogleStatus> {
  return request("/api/v1/google/status");
}

/** Saves the Google OAuth client credentials (issue #117). Omitting
 * `clientSecret` keeps whatever is already stored — the credentials form's
 * secret field is write-only and shows a masked placeholder, not the real
 * value, so there's nothing to resubmit unless the operator chose to
 * overwrite it. Every connected account is flipped to "needs_reconnect" by
 * the backend as part of this call, since a refresh token is only valid for
 * the OAuth client that minted it. */
export function saveGoogleCredentials(
  clientId: string,
  clientSecret: string | null,
): Promise<GoogleStatus> {
  // The key itself is left out, not sent as null, when keeping the stored
  // secret — the backend's GoogleCredentialsUpdate treats "absent" as the
  // sentinel for "unchanged", matching the PATCH convention this app uses
  // for every other partial-update field.
  const body: { client_id: string; client_secret?: string } = { client_id: clientId };
  if (clientSecret !== null) {
    body.client_secret = clientSecret;
  }
  return request("/api/v1/google/credentials", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

/** Removes the Google integration entirely: clears the stored credentials
 * and disconnects every account, returning to the same "unconfigured,
 * invisible" state as a fresh deployment. */
export function removeGoogleIntegration(): Promise<void> {
  return request("/api/v1/google/credentials", { method: "DELETE" });
}

export interface GoogleAccount {
  id: number;
  google_account_id: string;
  email: string;
  connection_state: string;
  created_at: string;
}

export function fetchGoogleAccounts(): Promise<GoogleAccount[]> {
  return request("/api/v1/google/accounts");
}

export function disconnectGoogleAccount(accountId: number): Promise<void> {
  return request(`/api/v1/google/accounts/${accountId}`, { method: "DELETE" });
}

export interface GoogleCalendar {
  id: number;
  google_calendar_id: string;
  summary: string;
  color: string;
  enabled: boolean;
}

/** Lists an account's calendars, seeding them from Google's own
 * per-calendar selection flag the first time this is called for the
 * account. */
export function fetchGoogleCalendars(accountId: number): Promise<GoogleCalendar[]> {
  return request(`/api/v1/google/accounts/${accountId}/calendars`);
}

/** Re-reads the account's calendar list from Google, picking up calendars
 * created since connecting while preserving the visibility and colour
 * already chosen for calendars that still exist. */
export function refreshGoogleCalendars(accountId: number): Promise<GoogleCalendar[]> {
  return request(`/api/v1/google/accounts/${accountId}/calendars/refresh`, { method: "POST" });
}

export interface GoogleCalendarUpdateInput {
  enabled?: boolean;
  color?: string;
}

/** A purely local write: never changes anything in Google. */
export function updateGoogleCalendar(
  accountId: number,
  calendarId: number,
  input: GoogleCalendarUpdateInput,
): Promise<GoogleCalendar> {
  return request(`/api/v1/google/accounts/${accountId}/calendars/${calendarId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

/** The URL a "Connect" button navigates the whole page to (not a fetch —
 * the consent flow is a full browser round trip through Google). The
 * backend performs the redirect, handles Google's callback, and sends the
 * browser back here; the client secret never reaches this code. */
export function googleConnectUrl(): string {
  return `${BASE_URL}/api/v1/google/connect`;
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

export function fetchTasks(listId: number, limit?: number): Promise<Page<Task>> {
  const limitParam = limit === undefined ? "" : `&limit=${limit}`;
  return request(`/api/v1/tasks?list_id=${listId}${limitParam}`);
}

export function fetchTasksByTag(tagId: number): Promise<Page<Task>> {
  return request(`/api/v1/tasks?tag_id=${tagId}`);
}

/** What a Key Result's count is made of — so the number can be checked
 * rather than trusted (ADR 0012). */
export function fetchTasksByKeyResult(keyResultId: number): Promise<Page<Task>> {
  return request(`/api/v1/tasks?key_result_id=${keyResultId}`);
}

/** The built-in Smart Lists — computed queries, never storage. */
export type SmartView = "today" | "next7" | "all";

/** Display names of the built-in Smart Lists, in sidebar order. */
export const SMART_LABELS: Record<SmartView, string> = {
  today: "Today",
  next7: "Next 7 Days",
  all: "All",
};

/** List / Tag / Priority narrowing, shared by every view that offers it
 * (Search adds a Status field of its own on top — see `SearchFilters`). */
export interface ListTagPriorityFilters {
  listId: number | null;
  tagId: number | null;
  priority: Priority | null;
}

/** Sets `list_id`/`tag_id`/`priority` on `params` for each non-null filter. */
function appendListTagPriorityParams(
  params: URLSearchParams,
  filters: ListTagPriorityFilters,
): void {
  if (filters.listId !== null) {
    params.set("list_id", String(filters.listId));
  }
  if (filters.tagId !== null) {
    params.set("tag_id", String(filters.tagId));
  }
  if (filters.priority !== null) {
    params.set("priority", filters.priority);
  }
}

/** The filters "All" narrows by. No status field: `view` already forces open
 * tasks only, and Completed has its own toggle. */
export type AllFilters = ListTagPriorityFilters;

/** `today` is the caller's local day (YYYY-MM-DD); Smart Lists are open tasks
 * only. `filters` narrows further — only "All" offers the controls for it,
 * so Today/Next 7 Days always pass none. */
export function fetchSmartTasks(
  view: SmartView,
  today: string,
  filters: AllFilters,
): Promise<Page<Task>> {
  const params = new URLSearchParams({ view, today });
  appendListTagPriorityParams(params, filters);
  return request(`/api/v1/tasks?${params.toString()}`);
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
  description?: string;
  list_id?: number;
  section_id?: number;
  priority?: Priority;
  tag_ids?: number[];
  /** Schedule fields follow the same wire conventions as TaskPatch. */
  start_date?: string;
  due_date?: string;
  is_all_day?: boolean;
  time_zone?: string;
  reminders?: string[];
  recurrence?: string;
  /** Set only when creating a Task by converting an Event (issue #111). */
  source_google_calendar_id?: number;
  source_google_event_id?: string;
  /** The Key Result this Task's completion should count toward, if any. */
  key_result_id?: number;
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

/** One person on an Event — an attendee, or its organiser (issue #110).
 * `display_name` is Google's optional friendly name; render `email` when
 * it's absent. */
export interface EventAttendee {
  email: string;
  display_name: string | null;
}

/** A read-only Google Calendar Event (issue #107): fetched live for the
 * visible window, never stored. Unlike a Task, an Event has no timezone of
 * its own on the wire — it always renders at its true hour in the
 * *viewer's* timezone, deliberately asymmetric with a Task's own stored
 * timezone (see the Entry glossary entry).
 *
 * `location`, `description`, `attendees`, `organizer`, `html_link`,
 * `account_email` and `calendar_summary` (issue #110) exist only for the
 * read-only Event detail popover — nothing else in tuk-tuk reads them. */
export interface Event {
  id: string;
  title: string;
  start_date: string;
  due_date: string;
  is_all_day: boolean;
  color: string;
  location: string | null;
  description: string | null;
  attendees: EventAttendee[];
  organizer: EventAttendee | null;
  html_link: string;
  account_email: string;
  calendar_summary: string;
  /** The local calendar row id and Google's own event id (issue #111):
   * what "Convert to task" sends back as the Task's provenance. */
  calendar_id: number;
  google_event_id: string;
}

/** One connected Google Account whose Events couldn't be read this time
 * (issue #109). `kind` tells apart a retry-safe failure ("transient": a
 * network hiccup, a server error, rate limiting — the account stays
 * connected) from one that never can succeed on its own ("terminal": the
 * grant was revoked or expired — the account needs reconnecting). */
export interface EventFailure {
  account_id: number;
  email: string;
  kind: "transient" | "terminal";
  message: string;
}

export interface EventsResult {
  events: Event[];
  failures: EventFailure[];
}

/** Events from every enabled Google Calendar whose window intersects the
 * inclusive [start, end] day window — the same day-window contract as
 * fetchCalendarTasks, on Events' own endpoint so Google's reachability never
 * slows down Task rendering. Never blank on a failure: `failures` names
 * whichever accounts didn't answer while `events` still carries every
 * account that did. `force` bypasses the backend's short-lived cache — the
 * Calendar toolbar's manual refresh, which doubles as the Retry affordance
 * for a failed account (issue #109). */
export function fetchCalendarEvents(
  rangeStart: string,
  rangeEnd: string,
  force = false,
): Promise<EventsResult> {
  const forceParam = force ? "&force=true" : "";
  return request(`/api/v1/events?range_start=${rangeStart}&range_end=${rangeEnd}${forceParam}`);
}

/** Undated open tasks — the unscheduled panel's query. */
export function fetchUnscheduledTasks(): Promise<Page<Task>> {
  return request("/api/v1/tasks?scheduled=false&completed=false&limit=200");
}

/** The filters a search combines with its query — null means "any". */
export interface SearchFilters extends ListTagPriorityFilters {
  completed: boolean | null;
}

/** Tasks matching the query in title, description or Check Item titles,
 * narrowed by the filters. Callers skip the call for a blank query — the
 * API returns nothing for one. */
export function fetchSearchTasks(query: string, filters: SearchFilters): Promise<Page<Task>> {
  const params = new URLSearchParams({ search: query, limit: "200" });
  appendListTagPriorityParams(params, filters);
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
  /** null detaches the Task from its Key Result. */
  key_result_id?: number | null;
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
  target: number;
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
  target?: number;
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
 * Becoming Numeric requires a target in the same patch; becoming Boolean
 * sweeps target / step / unit back to their defaults. */
export interface HabitPatch {
  name?: string;
  type?: HabitType;
  target?: number;
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
 * of the Target (0..1], so Numeric habits render partial fills. */
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

/** A Goal's status (ADR 0012); only "active" is exercised in this slice. */
export type GoalStatus = "active" | "closed" | "abandoned";

/** A Key Result's value source (ADR 0012). "manual" is typed in; the other
 * two are computed on read and reject writes to current_value (409). */
export type KeyResultSource = "manual" | "habit_checkins" | "task_count";

/** One measurable number belonging to a Goal (ADR 0012). `ratio` and, for
 * automatic sources, `current_value` are computed server-side on every
 * read — never edited locally as if they were plain fields. */
export interface KeyResult {
  id: number;
  goal_id: number;
  name: string;
  source: KeyResultSource;
  start_value: number;
  target_value: number;
  current_value: number;
  source_habit_id: number | null;
  sort_order: number;
  ratio: number;
}

export interface KeyResultCreateInput {
  name: string;
  source?: KeyResultSource;
  start_value?: number;
  target_value?: number;
  current_value?: number;
  source_habit_id?: number;
}

/** Absent fields stay unchanged. current_value is rejected with 409 for
 * automatic Key Results. */
export interface KeyResultPatch {
  name?: string;
  start_value?: number;
  target_value?: number;
  current_value?: number;
  sort_order?: number;
}

/** A Goal — a durable outcome with a window (ADR 0012). `obstacle` and
 * `if_then_plan` are WOOP framing on top of the OKR spine, both optional so
 * a Goal is creatable in seconds. `start_date`/`end_date` are null only for
 * the Sprint-Goal-seeded focused Goal (issue #238). `score` is the
 * unweighted mean of the Key Results' ratios, or null with none. */
export interface Goal {
  id: number;
  title: string;
  description: string;
  obstacle: string | null;
  if_then_plan: string | null;
  /** YYYY-MM-DD, defaulting to the current quarter on create. */
  start_date: string | null;
  end_date: string | null;
  status: GoalStatus;
  is_focused: boolean;
  final_score: number | null;
  retro: string | null;
  key_results: KeyResult[];
  score: number | null;
  created_at: string;
}

export interface GoalCreateInput {
  title: string;
  description?: string;
  obstacle?: string;
  if_then_plan?: string;
  start_date?: string;
  end_date?: string;
}

export function fetchGoals(): Promise<Page<Goal>> {
  return request("/api/v1/goals");
}

export function createGoal(input: GoalCreateInput): Promise<Goal> {
  return request("/api/v1/goals", { method: "POST", body: JSON.stringify(input) });
}

/** Absent fields stay unchanged; explicit null clears obstacle / if_then_plan / retro. */
export interface GoalPatch {
  title?: string;
  description?: string;
  obstacle?: string | null;
  if_then_plan?: string | null;
  start_date?: string;
  end_date?: string;
  status?: GoalStatus;
  is_focused?: boolean;
  retro?: string | null;
}

export function updateGoal(goalId: number, patch: GoalPatch): Promise<Goal> {
  return request(`/api/v1/goals/${goalId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteGoal(goalId: number): Promise<void> {
  return request(`/api/v1/goals/${goalId}`, { method: "DELETE" });
}

/** Key Result mutations return the full parent Goal (ADR 0012) — a Key
 * Result has no life outside its Goal, so there's no top-level collection. */
export function createKeyResult(goalId: number, input: KeyResultCreateInput): Promise<Goal> {
  return request(`/api/v1/goals/${goalId}/key-results`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateKeyResult(
  goalId: number,
  keyResultId: number,
  patch: KeyResultPatch,
): Promise<Goal> {
  return request(`/api/v1/goals/${goalId}/key-results/${keyResultId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteKeyResult(goalId: number, keyResultId: number): Promise<void> {
  return request(`/api/v1/goals/${goalId}/key-results/${keyResultId}`, { method: "DELETE" });
}

/** The Goal Stand-up shows (ADR 0012, issue #238): only the focused one,
 * with its Key Result progress, or null if none is focused. */
export function fetchFocusedGoal(): Promise<Goal | null> {
  return request("/api/v1/stand-up/focused-goal");
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

/** Open tasks across every List — the Focus link picker's choices, and the
 * client-side source for the sidebar's open-Task counts (issue #195): held
 * once and reconciled as Tasks change, never an aggregate endpoint. */
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

/** A Stand-up Bullet's section, in display order. */
export type StandupSection = "yesterday" | "today" | "blockers";

export interface StandupBullet {
  id: number;
  section: StandupSection;
  text: string;
  sort_order: number;
}

/** The history list's row shape — no Bullets, one per persisted date. */
export interface StandupEntrySummary {
  id: number;
  date: string;
  sprint_goal_snapshot: string;
}

export interface StandupEntry extends StandupEntrySummary {
  bullets: StandupBullet[];
}

/** The history list — only dates with an actual persisted Entry, newest first. */
export function fetchStandupEntries(): Promise<Page<StandupEntrySummary>> {
  return request("/api/v1/stand-up/entries");
}

/** Rejects with a "not_found" ApiError when `date` has no persisted Entry —
 * the caller renders an empty, immediately-editable form in that case. */
export function fetchStandupEntry(date: string): Promise<StandupEntry> {
  return request(`/api/v1/stand-up/entries/${date}`);
}

export function deleteStandupEntry(date: string): Promise<void> {
  return request(`/api/v1/stand-up/entries/${date}`, { method: "DELETE" });
}

/** Bullet mutations return the full parent Entry (composition), and lazily
 * create it on the first Bullet saved for `date`. */
export function createStandupBullet(
  date: string,
  section: StandupSection,
  text: string,
): Promise<StandupEntry> {
  return request(`/api/v1/stand-up/entries/${date}/bullets`, {
    method: "POST",
    body: JSON.stringify({ section, text }),
  });
}

/** Absent fields stay unchanged; explicit null is rejected by the API. */
export interface StandupBulletPatch {
  text?: string;
  sort_order?: number;
}

export function updateStandupBullet(
  date: string,
  bulletId: number,
  patch: StandupBulletPatch,
): Promise<StandupEntry> {
  return request(`/api/v1/stand-up/entries/${date}/bullets/${bulletId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteStandupBullet(date: string, bulletId: number): Promise<void> {
  return request(`/api/v1/stand-up/entries/${date}/bullets/${bulletId}`, { method: "DELETE" });
}

/** A read-only Today chip suggestion sourced from the Today Smart List
 * (Tasks due today) — not persisted, no dismissal/seen-state. */
export interface StandupSuggestion {
  task_id: number;
  title: string;
}

/** Opt-in suggestion chips for the Today section, judged against `date`
 * (the caller's local day) using the same query as the Today Smart List. */
export function fetchTodaySuggestions(date: string): Promise<StandupSuggestion[]> {
  return request(`/api/v1/stand-up/suggestions/today?date=${date}`);
}

/** A suggestion chip for the Yesterday section: the title of a Task
 * completed, or a Completed Occurrence logged, on the day before `date`,
 * plus that prior day's own Stand-up "Today" bullets (issue #147). A pure
 * read — no suggestion state is persisted or tracked as seen. */
export interface StandupYesterdaySuggestion {
  title: string;
}

export function fetchYesterdaySuggestions(date: string): Promise<StandupYesterdaySuggestion[]> {
  return request(`/api/v1/stand-up/suggestions/yesterday?date=${date}`);
}

/** Whether the Stand-up nav item/route is visible at all (issue #140). A
 * UI-only visibility switch: turning it off never blocks the stand-up
 * routes above and never touches stored entries or bullets — the app
 * fetches this once at load to decide whether to show the nav item,
 * mirroring how GoogleStatus is fetched once for Settings. */
export interface StandupSettings {
  enabled: boolean;
}

export function fetchStandupSettings(): Promise<StandupSettings> {
  return request("/api/v1/settings/stand-up");
}

export function updateStandupSettings(enabled: boolean): Promise<StandupSettings> {
  return request("/api/v1/settings/stand-up", {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });
}

/** Whether each of Calendar/Goals/Habits/Focus/Assistant's nav item/route is
 * visible (this feature) — same UI-only visibility contract as Stand-up
 * above, one flag per section, fetched once at load. Tasks is never
 * included: it can't be hidden. */
export interface SectionSettings {
  calendar: boolean;
  goals: boolean;
  habits: boolean;
  focus: boolean;
  assistant: boolean;
}

export function fetchSectionSettings(): Promise<SectionSettings> {
  return request("/api/v1/settings/sections");
}

export function updateSectionSettings(settings: SectionSettings): Promise<SectionSettings> {
  return request("/api/v1/settings/sections", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

/** Active hours (issue #210): the band of the day the Calendar renders at
 * double height, compressing the hours outside it. Server-side, not in
 * layoutPrefs — the band describes the user, not a browser. `start`/`end`
 * are "HH:MM" wall-clock labels aligned to 30 minutes, start before end,
 * no wrap past midnight (the server rejects a band that breaks those). */
export interface ActiveHoursSettings {
  enabled: boolean;
  start: string;
  end: string;
}

export function fetchActiveHoursSettings(): Promise<ActiveHoursSettings> {
  return request("/api/v1/settings/active-hours");
}

export function updateActiveHoursSettings(
  settings: ActiveHoursSettings,
): Promise<ActiveHoursSettings> {
  return request("/api/v1/settings/active-hours", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

/** The Settings > Database section (issue #256): which engine the running
 * app is actually configured for, and a connection probe for a candidate
 * PostgreSQL URL that never switches anything. `host`/`database` are only
 * populated for postgresql; the username, password, and full URL are never
 * reported. */
export interface DatabaseStatus {
  engine: "sqlite" | "postgresql";
  host: string | null;
  database: string | null;
}

export function fetchDatabaseStatus(): Promise<DatabaseStatus> {
  return request("/api/v1/settings/database");
}

export type DatabaseTestConnectionReason =
  "unreachable" | "auth_rejected" | "database_not_found" | "unknown";

export interface DatabaseTestConnectionResult {
  ok: boolean;
  version: string | null;
  has_existing_data: boolean | null;
  reason: DatabaseTestConnectionReason | null;
  message: string | null;
}

export function testDatabaseConnection(
  connectionUrl: string,
): Promise<DatabaseTestConnectionResult> {
  return request("/api/v1/settings/database/test-connection", {
    method: "POST",
    body: JSON.stringify({ connection_url: connectionUrl }),
  });
}
