import { vi } from "vitest";

import {
  type AssistantChatTurn,
  type AssistCaptureDraft,
  type DatabaseStatus,
  type DatabaseTestConnectionResult,
  type GitHubTokenReadStatus,
  type GoalStatus,
  type HabitType,
  type KeyResultSource,
  type PlannedWork,
  type PlannedWorkRead,
  type Priority,
  type ViewMode,
} from "../api";
import { entryDayWindow } from "../calendar";
import { addDays, zonedDay, zonedTime } from "../dates";
import { habitDueOn } from "../habitFrequency";
import { byName, SORT_GAP } from "../ordering";
import { DEVICE_OPT_IN_KEY } from "../reminderDelivery";
import { decrementCount, nextOccurrenceISO } from "./fakeRecurrence";

/** The fake's stand-in for the backend's IANA validation: unknown zone
 * names throw out of Intl.DateTimeFormat, which the route maps to 422. */
function isKnownZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

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
  key_result_id: number | null;
  planned_work?: PlannedWorkRead | null;
  estimate_minutes?: number | null;
  check_items: FakeCheckItem[];
  tags: FakeTag[];
  created_at: string;
}

/** A lease on one due Reminder, as the server's claim hands it out (issue
 * #561). */
export interface FakeReminderClaim {
  id: number;
  task_id: number;
  task_title: string;
  offset: string;
  occurrence_due: string;
  fire_at: string;
  state: "claimed" | "shown" | "failed" | "snoozed";
  attempt: number;
  snoozed_until?: string | null;
  lease_token: string;
  lease_expires_at: string;
}

export interface FakeReminderSnooze {
  id: number;
  minutes: number;
}

/** A Reminder held by Quiet hours, as the claim lists it (issue #567). */
export interface FakeHeldReminder {
  task_id: number;
  task_title: string;
  offset: string;
  fire_at: string;
  deliver_at: string;
}

export interface FakeReminderReport {
  id: number;
  outcome: "shown" | "failed";
  lease_token: string;
}

/** A Reminder whose delivery window passed unseen (issue #565). */
export interface FakeMissedReminder {
  task_id: number;
  task_title: string;
  offset: string;
  occurrence_due: string;
  fire_at: string;
  is_all_day: boolean;
  time_zone: string | null;
  /** Its ledger row, when a tab ever claimed it (#566); null otherwise. */
  delivery_id: number | null;
}

/** The key a dismissal names a missed reminder by. */
export type FakeMissedDismissal = Pick<FakeMissedReminder, "task_id" | "offset" | "occurrence_due">;

/** A snooze sent from the missed list for a never-claimed Reminder. */
export type FakeMissedSnooze = FakeMissedDismissal & { minutes: number };

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
  target: number;
  step: number;
  unit: string | null;
  icon: string | null;
  color: string | null;
  encouragement: string;
  frequency: string;
  is_archived: boolean;
  created_at: string;
  pauses: FakeHabitPause[];
  /** Skipped days (issue #564), oldest first. */
  skips: string[];
}

export interface FakeHabitPause {
  id: number;
  habit_id: number;
  start_date: string;
  end_date: string | null;
}

export interface FakeKeyResult {
  id: number;
  goal_id: number;
  name: string;
  source: KeyResultSource;
  start_value: number;
  target_value: number;
  /** Stored only for "manual"; ignored (recomputed) for automatic sources,
   * mirroring the backend, where these never persist. */
  current_value: number;
  source_habit_id: number | null;
  sort_order: number;
}

export interface FakeGoal {
  id: number;
  title: string;
  description: string;
  obstacle: string | null;
  if_then_plan: string | null;
  start_date: string | null;
  end_date: string | null;
  status: GoalStatus;
  is_focused: boolean;
  final_score: number | null;
  retro: string | null;
  key_results: FakeKeyResult[];
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
  /** The client's identity for the run (#546), never shown to readers. */
  client_run_id?: string | null;
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

/** A GitHub Token (#578) as the backend lists it. */
export interface FakeGitHubToken {
  id: number;
  /** Null while GitHub can't tell the token's owner (ADR 0020). */
  owner_login: string | null;
  owner_kind: "user" | "organization" | null;
  expires_at: string | null;
  /** Expires within 7 days, or already has (#584). The backend works this
   * out from its clock; the fake takes it as given. */
  expires_soon: boolean;
  connection_state: "connected" | "needs_reconnect";
  created_at: string;
}

/** What GitHub would say a pasted token is, for `githubTokenIdentities`. */
export interface FakeGitHubIdentity {
  /** Null for a token whose owner GitHub can't tell yet, as for an
   * organisation's token before it allows or approves it. */
  owner_login: string | null;
  owner_kind?: "user" | "organization";
  expires_at?: string | null;
}

let nextGitHubTokenId = 1;

/** A connected GitHub Token for `installFakeApi({ githubTokens })`. */
export function fakeGitHubToken(
  ownerLogin: string | null,
  overrides: Partial<FakeGitHubToken> = {},
): FakeGitHubToken {
  return {
    id: nextGitHubTokenId++,
    owner_login: ownerLogin,
    owner_kind: "user",
    expires_at: null,
    expires_soon: false,
    connection_state: "connected",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** A repository a GitHub Token can read (#581), for
 * `installFakeApi({ githubReadableRepositories })`. */
export interface FakeReadableRepository {
  github_repo_id: number;
  full_name: string;
  private?: boolean;
}

/** A Watched Repository (#581) as the backend lists it. */
export interface FakeWatchedRepository {
  id: number;
  github_token_id: number;
  github_repo_id: number;
  full_name: string;
  private: boolean;
  created_at: string;
}

let nextWatchedRepositoryId = 1;

/** A Repository View (#580) as the backend lists it. */
export interface FakeRepositoryView {
  id: number;
  name: string;
  sort_order: number;
  watched_repository_ids: number[];
  author: string | null;
  label: string | null;
  assignee: string | null;
  hide_drafts: boolean;
  hide_bots: boolean;
  active_tab: "pull_requests" | "issues";
}

let nextRepositoryViewId = 1;

/** A Repository View for `installFakeApi({ repositoryViews })`, with no
 * saved filters, placed after every one made before it. */
export function fakeRepositoryView(
  name: string,
  watchedRepositoryIds: number[],
  overrides: Partial<FakeRepositoryView> = {},
): FakeRepositoryView {
  const id = nextRepositoryViewId++;
  return {
    id,
    name,
    sort_order: id * 1024,
    watched_repository_ids: watchedRepositoryIds,
    author: null,
    label: null,
    assignee: null,
    hide_drafts: false,
    hide_bots: false,
    active_tab: "pull_requests",
    ...overrides,
  };
}

/** An open Pull Request (#579) as the backend's read lists it: already
 * classified by `relationship`. Its repository is `repository` (by
 * `owner/name`); the fake fills in `watched_repository_id`. */
export interface FakeGitHubPullRequest {
  repository: string;
  number: number;
  title: string;
  url: string;
  author: string | null;
  author_is_bot: boolean;
  created_at: string;
  updated_at: string;
  labels: { name: string; color: string }[];
  is_draft: boolean;
  review_decision: "approved" | "changes_requested" | "pending";
  ci_status: "pass" | "fail" | "pending" | null;
  relationship: "review_requested" | "mine" | "other";
}

/** An open Pull Request for `installFakeApi({ githubPullRequests })`, in
 * octocat/dotfiles unless `repository` says otherwise. */
export function fakeGitHubPullRequest(
  number: number,
  title: string,
  overrides: Partial<FakeGitHubPullRequest> = {},
): FakeGitHubPullRequest {
  const repository = overrides.repository ?? "octocat/dotfiles";
  return {
    repository,
    number,
    title,
    url: `https://github.com/${repository}/pull/${number}`,
    author: "hubot",
    author_is_bot: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    labels: [],
    is_draft: false,
    review_decision: "pending",
    ci_status: null,
    relationship: "other",
    ...overrides,
  };
}

/** An open GitHub Issue (#582) as the backend's read lists it. Its
 * repository is `repository` (by `owner/name`); the fake fills in
 * `watched_repository_id`. */
export interface FakeGitHubIssue {
  repository: string;
  number: number;
  title: string;
  url: string;
  author: string | null;
  author_is_bot: boolean;
  assignees: string[];
  created_at: string;
  updated_at: string;
  labels: { name: string; color: string }[];
  comment_count: number;
}

/** An open GitHub Issue for `installFakeApi({ githubIssues })`, in
 * octocat/dotfiles unless `repository` says otherwise. */
export function fakeGitHubIssue(
  number: number,
  title: string,
  overrides: Partial<FakeGitHubIssue> = {},
): FakeGitHubIssue {
  const repository = overrides.repository ?? "octocat/dotfiles";
  return {
    repository,
    number,
    title,
    url: `https://github.com/${repository}/issues/${number}`,
    author: "hubot",
    author_is_bot: false,
    assignees: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    labels: [],
    comment_count: 0,
    ...overrides,
  };
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

/** An account (ADR 0018). Mirrors the backend's User row plus the plain
 * password the fake login checks, standing in for the stored hash. The
 * fields `GET /auth/me` returns are the CurrentUser shape. */
export interface FakeUser {
  id: number;
  username: string;
  email: string | null;
  is_admin: boolean;
  is_active: boolean;
  password: string;
  /** Forced step: a temporary password to replace (#471). */
  must_change_password: boolean;
  /** Forced step: the upgraded single user's profile to complete (#472). */
  must_complete_profile: boolean;
  /** When the password was last set (#475), ISO-8601: on creation, an
   * admin's temporary password, and the user's own change. Only ever on
   * the user's own record (GET /auth/me), never in the admin list. */
  password_changed_at: string;
  /** When the account was last served a signed-in request (#478), ISO-8601;
   * null until then. The fake middleware moves it like the backend's: at
   * most every LAST_ACTIVE_WRITE_INTERVAL_MS. Only in the admin record. */
  last_active_at: string | null;
  /** ISO-8601; only the admin record carries it. Defaults when absent. */
  created_at?: string;
  /** Mirrors the backend's per-User lockout (users.login_locked_until still
   * in the future, issues #339, #408): seed true and /login answers this
   * account 429 too_many_attempts before checking the password, as does
   * /password for its session; an Admin's reset lifts it. The fake never
   * counts failures itself. */
  login_locked?: boolean;
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
  goals: FakeGoal[];
  focusSessions: FakeFocusSession[];
  timers: FakeTimer[];
  requests: RecordedRequest[];
  /** Task-read failure (#441): while set, each `GET /api/v1/tasks` it
   * returns true for answers 500. Mutate directly in a test. */
  failTaskRead: ((params: URLSearchParams) => boolean) | null;
  /** Task-read gate (#441): while set, `GET /api/v1/tasks` waits on it, so a
   * test can observe the loading state before the read resolves. */
  taskReadGate: Promise<void> | null;
  /** Read failure (#442): while set, each `GET` whose pathname it returns
   * true for answers 500. Mutate directly in a test. */
  failRead: ((pathname: string) => boolean) | null;
  /** Read gate (#442): while set, each `GET` whose pathname `match` accepts
   * waits on `gate`, so a test can observe a view's loading state. */
  readGate: { match: (pathname: string) => boolean; gate: Promise<void> } | null;
  /** Write failure (#544): while set, each non-GET request it returns true
   * for answers 500 and changes nothing. Mutate directly in a test. */
  failWrite: ((method: string, pathname: string) => boolean) | null;
  /** Lost response (#546): while set, each non-GET request it returns true
   * for is handled in full, then the client sees a network error instead
   * of the response, as when the connection drops after the save. */
  loseWriteResponse: ((method: string, pathname: string) => boolean) | null;
  /** Write gate (#544): while set, each non-GET request `match` accepts
   * waits on `gate` before it is handled, so a test can observe a saving
   * state or repeat the activation while the write is in flight. */
  writeGate: { match: (method: string, pathname: string) => boolean; gate: Promise<void> } | null;
  /** Whether this browser holds a valid session cookie. Mutate directly to
   * simulate a session lapsing mid-test (the backend's epoch bump). */
  loggedIn: boolean;
  /** Every account on the instance. Empty mirrors a fresh install (ADR
   * 0018): every route but /login and /setup answers "setup_required" and
   * /setup creates the first Admin. Mutate a user directly to simulate an
   * admin disabling them or setting a forced step. */
  users: FakeUser[];
  /** Whose session the cookie carries while `loggedIn`. */
  sessionUserId: number;
  /** Every user's API tokens (#413), revoked ones included. */
  apiTokens: FakeApiToken[];
  /** Mirrors the backend's google_client_id/secret gate: whether the Google
   * integration is configured server-side. */
  googleConfigured: boolean;
  /** The stored client ID, echoed back by /status — not sensitive, unlike
   * the secret, which is never returned (only whether one is set). */
  googleClientId: string | null;
  googleClientSecretSet: boolean;
  googleAccounts: FakeGoogleAccount[];
  googleCalendars: FakeGoogleCalendar[];
  /** The signed-in User's GitHub Tokens (#578). */
  githubTokens: FakeGitHubToken[];
  /** What GitHub identifies each pasted token string as. A `github_pat_`
   * token missing here is one GitHub rejects (401). */
  githubTokenIdentities: Record<string, FakeGitHubIdentity>;
  /** While true, checking a pasted token fails transiently (502). */
  githubUnavailable: boolean;
  /** The repositories each GitHub Token can read (#581), keyed by the
   * token's owner login, so a token added through the UI reads them too.
   * An owner missing here reads none. */
  githubReadableRepositories: Record<string, FakeReadableRepository[]>;
  /** The signed-in User's Watched Repositories (#581). */
  watchedRepositories: FakeWatchedRepository[];
  /** Owner logins whose token GitHub fails to read through, and how: as
   * the backend reports it per token in the picker and the GitHub view's
   * reads. A token GitHub rejects is flipped to needs_reconnect on a view
   * read (#584); reconnecting it clears its failure. */
  githubRepositoryFailures: Record<string, "unavailable" | "needs_reconnect">;
  /** The open Pull Requests the GitHub view's read answers with (#579), in
   * the backend's order (grouped, then most recently updated first). Only
   * those in a Watched Repository are returned. */
  githubPullRequests: FakeGitHubPullRequest[];
  /** How many more open Pull Requests each repository (by `owner/name`)
   * has on GitHub beyond those returned. */
  githubPullRequestOverflow: Record<string, number>;
  /** The open GitHub Issues the GitHub view's read answers with (#582),
   * in the backend's order (most recently updated first). Only those in a
   * Watched Repository are returned. */
  githubIssues: FakeGitHubIssue[];
  /** How many more open GitHub Issues each repository (by `owner/name`)
   * has on GitHub beyond those returned. */
  githubIssueOverflow: Record<string, number>;
  /** The signed-in User's Repository Views (#580). */
  repositoryViews: FakeRepositoryView[];
  /** When the GitHub view's reads say their data was fetched from GitHub
   * (#583); null for the moment of each read. */
  githubFetchedAt: string | null;
  /** Owner logins whose token GitHub couldn't be reached through, so the
   * GitHub view's reads serve its last result as stale (#583): its items
   * still render, fetched at `githubFetchedAt`. */
  githubStaleOwners: string[];
  events: FakeEvent[];
  eventFailures: FakeEventFailure[];
  standupEntries: FakeStandupEntry[];
  standupYesterdaySuggestions: FakeStandupYesterdaySuggestion[];
  /** The Stand-up visibility toggle (issue #140) — server-defaulted to
   * true, matching the backend's default. */
  standupEnabled: boolean;
  /** Now (issue #547): the Settings toggle (off by default) and the chosen
   * Task's id, stored apart from every other setting. */
  nowEnabled: boolean;
  nowTaskId: number | null;
  /** The chosen occurrence's schedule (issue #549), mirroring the backend:
   * a pick whose Task is gone, completed or advanced reads as none.
   * `undefined` until a PUT, so seeded picks match whatever is seeded. */
  nowOccurrence?: string;
  /** The optional resume note on the selection (issue #554); cleared with it. */
  nowNote: string | null;
  /** The Now shortlist (issue #551), in order, each entry with its saved
   * occurrence (`undefined` for seeded entries until first read), pruned on
   * read by the same rule as the Now pick. */
  nowShortlist: { taskId: number; occurrence?: string }[];
  /** The Calendar/Goals/Habits/Focus/Assistant visibility toggles (this
   * feature) — server-defaulted to all-true, matching the backend. */
  sectionSettings: {
    calendar: boolean;
    goals: boolean;
    habits: boolean;
    focus: boolean;
    assistant: boolean;
  };
  activeHours: { enabled: boolean; start: string; end: string };
  /** Planning window (issue #563): the capacity summary's band. */
  planningWindow: { enabled: boolean; start: string; end: string };
  /** Gentle return (issue #548): Today collapses earlier overdue Tasks. */
  gentleReturn: boolean;
  /** Reminder notifications (issue #557): the User's delivery opt-in. */
  reminderNotifications: boolean;
  /** Reminder delivery (issue #561): what claims hand out. The fake plays
   * the server's ledger simply: each claim is handed out once, and only
   * while the opt-in is on. Isolation and deduplication are proven by the
   * backend's tests, never here. */
  reminderClaims: FakeReminderClaim[];
  /** Every shown/failed report a tab sent, in order. */
  reminderReports: FakeReminderReport[];
  /** Every snooze a tab sent, in order (issue #566). */
  reminderSnoozes: FakeReminderSnooze[];
  /** Quiet hours (issue #567): the User's band, and what each claim says
   * is held and until when. The fake never computes holds itself. */
  quietHours: { enabled: boolean; start: string; end: string };
  heldReminders: FakeHeldReminder[];
  quietUntil: string | null;
  /** Missed reminders (issue #565): what the missed list returns while the
   * opt-in is on, less those dismissed. */
  missedReminders: FakeMissedReminder[];
  /** Every dismissal a tab sent, in order. */
  missedDismissals: FakeMissedDismissal[];
  /** Every snooze sent from the missed list by key (#566), in order. */
  missedSnoozes: FakeMissedSnooze[];
  /** Settings > Database (issue #256): the engine the fake app reports
   * itself as running, and what the test-connection probe answers with. */
  databaseStatus: DatabaseStatus;
  databaseTestConnectionResult: DatabaseTestConnectionResult;
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
  /** The Voice Assistant's LiveKit config (ADR 0015, issue #366). All
   * null/unset by default, matching a fresh deployment; the secret is
   * write-only so only whether one is stored exists here. */
  voiceLivekitUrl: string | null;
  voiceLivekitApiKey: string | null;
  voiceSecretSet: boolean;
}

/** The password installFakeApi's default user signs in with. */
export const FAKE_PASSWORD = "correct-password";

let nextUserId = 100;

const DEFAULT_PASSWORD_CHANGED_AT = "2026-01-01T00:00:00Z";

/** An account for `installFakeApi({ users })`. Defaults to an active,
 * non-admin Member with FAKE_PASSWORD and no forced step. */
export function fakeUser(username: string, overrides: Partial<FakeUser> = {}): FakeUser {
  return {
    id: nextUserId++,
    username,
    email: `${username}@example.com`,
    is_admin: false,
    is_active: true,
    password: FAKE_PASSWORD,
    must_change_password: false,
    must_complete_profile: false,
    password_changed_at: DEFAULT_PASSWORD_CHANGED_AT,
    last_active_at: null,
    ...overrides,
  };
}

/** The instance's default sole account: the Admin a test is signed in as
 * unless it seeds `users` itself (mirrors the backend suite's test admin). */
export const FAKE_ADMIN: FakeUser = {
  id: 1,
  username: "admin",
  email: "admin@example.com",
  is_admin: true,
  is_active: true,
  password: FAKE_PASSWORD,
  must_change_password: false,
  must_complete_profile: false,
  password_changed_at: DEFAULT_PASSWORD_CHANGED_AT,
  last_active_at: null,
};

/** An API token (#413). The backend stores only the value's hash; the fake
 * keeps the value so a test can look for it on screen. */
export interface FakeApiToken {
  id: number;
  owner_id: number;
  name: string;
  /** Its audience (#525): the API itself, or the shared MCP server. */
  kind: "api" | "mcp";
  /** `tuk_pat_<owner id>_` (`tuk_mcp_` for an MCP token) plus the
   * secret's first 8 hex characters. */
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  /** Set by DELETE; a revoked token is never listed again. */
  revoked_at: string | null;
  token: string;
}

let nextApiTokenId = 1;

const TOKEN_PREFIXES = { api: "tuk_pat_", mcp: "tuk_mcp_" } as const;

/** A token value in the backend's format: `tuk_pat_<user id>_<64 hex>`,
 * or `tuk_mcp_...` for an MCP token. */
function mintTokenValue(ownerId: number, id: number, kind: FakeApiToken["kind"]): string {
  const secret = Array.from({ length: 8 }, (_, i) =>
    ((id * 2654435761 + i * 40503) >>> 0).toString(16).padStart(8, "0"),
  ).join("");
  return `${TOKEN_PREFIXES[kind]}${ownerId}_${secret}`;
}

/** A live, never-used token owned by `ownerId` for
 * `installFakeApi({ apiTokens })`. */
export function fakeApiToken(
  ownerId: number,
  name: string,
  overrides: Partial<FakeApiToken> = {},
): FakeApiToken {
  const id = nextApiTokenId++;
  const kind = overrides.kind ?? "api";
  const token = mintTokenValue(ownerId, id, kind);
  return {
    id,
    owner_id: ownerId,
    name,
    kind,
    prefix: token.slice(0, `${TOKEN_PREFIXES[kind]}${ownerId}_`.length + 8),
    created_at: "2026-01-01T00:00:00Z",
    last_used_at: null,
    revoked_at: null,
    token,
    ...overrides,
  };
}

/** What the token endpoints return for `token`: never its value. */
function apiTokenRecord(token: FakeApiToken): Record<string, unknown> {
  return {
    id: token.id,
    name: token.name,
    kind: token.kind,
    prefix: token.prefix,
    created_at: token.created_at,
    last_used_at: token.last_used_at,
  };
}

// Mirrors the backend's token name rule (app.routers.v1.api_tokens, #413).
const MAX_TOKEN_NAME_LENGTH = 100;

/** Mirrors the backend's LAST_ACTIVE_WRITE_INTERVAL (app.middleware, #478). */
const LAST_ACTIVE_WRITE_INTERVAL_MS = 5 * 60_000;

// Mirrors the backend's setup/profile validation (auth router, ADR 0018).
const MAX_USERNAME_LENGTH = 64;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+$/;

/** What `GET /auth/me` returns for `account` (the CurrentUser shape). */
function currentUserRecord(account: FakeUser): Record<string, unknown> {
  return {
    id: account.id,
    username: account.username,
    email: account.email,
    is_admin: account.is_admin,
    must_change_password: account.must_change_password,
    must_complete_profile: account.must_complete_profile,
    password_changed_at: account.password_changed_at,
  };
}

/** What the admin users endpoints return for `account` (AdminUserRead,
 * #412): account fields only, never anything the account owns. */
function adminUserRecord(account: FakeUser): Record<string, unknown> {
  return {
    id: account.id,
    username: account.username,
    email: account.email,
    is_admin: account.is_admin,
    is_active: account.is_active,
    must_change_password: account.must_change_password,
    must_complete_profile: account.must_complete_profile,
    created_at: account.created_at ?? "2026-01-01T00:00:00Z",
    last_active_at: account.last_active_at,
  };
}

/** The backend's per-field 409 (app.users.ensure_identity_free) when a User
 * other than `except` already holds `username` or `email`, ignoring case. */
function identityConflict(
  users: FakeUser[],
  except: FakeUser | null,
  username: string | undefined,
  email: string | undefined,
): Response | null {
  const others = users.filter((candidate) => candidate !== except);
  if (
    username !== undefined &&
    others.some((other) => other.username.toLowerCase() === username.toLowerCase())
  ) {
    return new Response(
      JSON.stringify({
        error: { code: "username_taken", message: "That username is already taken" },
      }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  }
  if (
    email !== undefined &&
    others.some((other) => other.email?.toLowerCase() === email.toLowerCase())
  ) {
    return new Response(
      JSON.stringify({ error: { code: "email_taken", message: "That email is already in use" } }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  }
  return null;
}

// All a User may reach while a forced step is pending (app.middleware),
// matched on method and path: reading /me is open, editing it is not.
const FORCED_STEP_ROUTES = new Set([
  "GET /api/v1/auth/me",
  "POST /api/v1/auth/complete",
  "POST /api/v1/auth/logout",
]);

// Mirrors the backend's MIN_PASSWORD_LENGTH (auth router, issue #338), so
// the fake behaves like the real backend for the frontend tests exercised
// against it.
const MIN_PASSWORD_LENGTH = 12;

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
let nextHabitPauseId = 9800;

/** Mirror the backend's pause interval test: both ends inclusive, a null
 * end open-ended. */
function pauseCovers(pause: FakeHabitPause, day: string): boolean {
  return pause.start_date <= day && (pause.end_date === null || day <= pause.end_date);
}

/** Mirrors the backend's times-per-week week (app.habit_days.HabitDays.week):
 * the Monday-to-Sunday week holding `today`, its Target never lowered by a
 * pause or skip, and excluded only when every day from the Habit start on is
 * paused. Null for other frequencies. */
function fakeHabitWeek(
  habit: FakeHabit,
  checkIns: { date: string; value: number }[],
  start: string,
  today: string,
) {
  const times = /TT_TIMES=(\d)/.exec(habit.frequency)?.[1];
  if (times === undefined) {
    return null;
  }
  const target = Number(times);
  const monday = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const valueOf = (day: string): number | undefined =>
    checkIns.find((checkIn) => checkIn.date === day)?.value;
  const isPaused = (day: string): boolean => habit.pauses.some((pause) => pauseCovers(pause, day));
  const started = days.filter((day) => day >= start);
  const done = days.filter((day) => (valueOf(day) ?? 0) >= habit.target).length;
  return {
    start: monday,
    end: days[6],
    target,
    done,
    remaining: Math.max(target - done, 0),
    paused_days: started.filter(isPaused).length,
    skipped_days: started.filter(
      (day) => habit.skips.includes(day) && !isPaused(day) && valueOf(day) === undefined,
    ).length,
    excluded: started.length > 0 && started.every(isPaused),
  };
}
let nextGoalId = 1300;
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

/** Why the fake backend rejects a planned work block, or null when valid. */
function plannedWorkRejection(block: PlannedWork): string | null {
  if (block.duration_minutes <= 0) return "Planned work needs a positive duration";
  const finish = new Date(
    new Date(block.start).getTime() +
      (block.duration_minutes + (block.buffer_minutes ?? 0)) * 60000,
  ).toISOString();
  const startDay = zonedDay(block.start, block.time_zone);
  const finishDay = zonedDay(finish, block.time_zone);
  const atMidnight =
    finishDay === addDays(startDay, 1) && zonedTime(finish, block.time_zone) === "00:00";
  return finishDay === startDay || atMidnight
    ? null
    : "Planned work must stay within one local day: it would run past midnight";
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
    key_result_id: null,
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

let nextReminderClaimId = 1;

/** One of `task`'s Reminders, held until quiet hours end (issue #567). */
export function fakeHeldReminder(
  task: FakeTask,
  offset: string,
  overrides: Partial<FakeHeldReminder> = {},
): FakeHeldReminder {
  return {
    task_id: task.id,
    task_title: task.title,
    offset,
    fire_at: task.due_date ?? "2026-11-10T23:00:00Z",
    deliver_at: "2026-11-11T07:00:00Z",
    ...overrides,
  };
}

/** A claim on one of `task`'s Reminders, due now. */
export function fakeReminderClaim(
  task: FakeTask,
  offset: string,
  overrides: Partial<FakeReminderClaim> = {},
): FakeReminderClaim {
  const id = nextReminderClaimId++;
  return {
    id,
    task_id: task.id,
    task_title: task.title,
    offset,
    occurrence_due: task.due_date ?? "2026-07-10T15:00:00Z",
    fire_at: task.due_date ?? "2026-07-10T15:00:00Z",
    state: "claimed",
    attempt: 1,
    lease_token: `lease-${id}`,
    lease_expires_at: "2026-07-10T15:01:00Z",
    ...overrides,
  };
}

/** One of `task`'s Reminders, missed for its current occurrence. */
export function fakeMissedReminder(
  task: FakeTask,
  offset: string,
  overrides: Partial<FakeMissedReminder> = {},
): FakeMissedReminder {
  const due = task.due_date ?? "2026-07-10T15:00:00Z";
  return {
    task_id: task.id,
    task_title: task.title,
    offset,
    occurrence_due: due,
    fire_at: due,
    is_all_day: task.is_all_day,
    time_zone: task.time_zone,
    delivery_id: null,
    ...overrides,
  };
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

/** A Habit as the server holds it. By default an established one, created long
 * before the suites' pinned "today", so an empty past day reads as missed. Pass
 * `created_at` to put its Habit start among the days on screen. */
export function fakeHabit(name: string, overrides: Partial<FakeHabit> = {}): FakeHabit {
  return {
    id: nextHabitId++,
    name,
    type: "boolean",
    target: 1,
    step: 1,
    unit: null,
    icon: null,
    color: null,
    encouragement: "",
    frequency: "FREQ=DAILY",
    is_archived: false,
    created_at: "2025-01-01T10:00:00Z",
    pauses: [],
    skips: [],
    ...overrides,
  };
}

export function fakeGoal(title: string, overrides: Partial<FakeGoal> = {}): FakeGoal {
  return {
    id: nextGoalId++,
    title,
    description: "",
    obstacle: null,
    if_then_plan: null,
    start_date: "2099-07-01",
    end_date: "2099-09-30",
    status: "active",
    is_focused: false,
    final_score: null,
    retro: null,
    key_results: [],
    created_at: "2026-07-03T10:00:00Z",
    ...overrides,
  };
}

let nextKeyResultId = 1400;

export function fakeKeyResult(
  goalId: number,
  name: string,
  overrides: Partial<FakeKeyResult> = {},
): FakeKeyResult {
  return {
    id: nextKeyResultId++,
    goal_id: goalId,
    name,
    source: "manual",
    start_value: 0,
    target_value: 1,
    current_value: 0,
    source_habit_id: null,
    sort_order: nextKeyResultId * SORT_GAP,
    ...overrides,
  };
}

/** A Key Result's ratio — duplicated from app.goal_score.key_result_ratio
 * (backend, source of truth for this arithmetic; see ADR 0012's noted
 * drift risk). Clamped 0-1; guards target == start. */
function keyResultRatio(start: number, target: number, current: number): number {
  if (target === start) return current >= target ? 1 : 0;
  return Math.max(0, Math.min(1, (current - start) / (target - start)));
}

/** A Key Result's current_value: stored for "manual", computed on read for
 * the automatic sources — duplicated from app.goal_read (see ADR 0012's
 * noted drift risk: the backend HTTP tests are the source of truth for
 * this arithmetic, this fake only needs to stay plausible for rendering). */
function keyResultCurrentValue(kr: FakeKeyResult, goal: FakeGoal, state: FakeApiState): number {
  if (kr.source === "habit_checkins") {
    if (kr.source_habit_id === null || goal.start_date === null || goal.end_date === null) {
      return 0;
    }
    return state.checkIns
      .filter(
        (c) =>
          c.habit_id === kr.source_habit_id &&
          c.date >= goal.start_date! &&
          c.date <= goal.end_date!,
      )
      .reduce((sum, c) => sum + c.value, 0);
  }
  if (kr.source === "task_count") {
    return state.tasks.filter((t) => t.key_result_id === kr.id && t.completed).length;
  }
  return kr.current_value;
}

/** A past-window `active` Goal closes on read, freezing its Score — the one
 * mutation this read path performs, mirroring app.goal_read._close_if_past_window.
 * A windowless Goal (the Sprint Goal seed) never auto-closes. */
function meanRatio(ratios: number[]): number | null {
  if (ratios.length === 0) return null;
  return Math.round((ratios.reduce((sum, r) => sum + r, 0) / ratios.length) * 100) / 100;
}

/** Leaving `active` freezes the Score and drops focus — mirrors
 * app.goal_read.settle. */
function settle(goal: FakeGoal, ratios: number[]): void {
  goal.final_score = meanRatio(ratios);
  goal.is_focused = false;
}

function closeIfPastWindow(goal: FakeGoal, ratios: number[]): void {
  if (goal.status !== "active" || goal.end_date === null) return;
  if (goal.end_date >= new Date().toISOString().slice(0, 10)) return;
  goal.status = "closed";
  settle(goal, ratios);
}

/** Builds the GoalRead wire shape: resolves each Key Result's current_value
 * and ratio, and the Goal's score (unweighted mean of ratios, null with no
 * Key Results) — mirrors app.goal_read.build_goal_read. */
function serializeGoal(goal: FakeGoal, state: FakeApiState): unknown {
  // Key Results are served in sort_order — that is what reordering moves.
  goal.key_results.sort((a, b) => a.sort_order - b.sort_order);
  const keyResults = goal.key_results.map((kr) => {
    const current_value = keyResultCurrentValue(kr, goal, state);
    return {
      ...kr,
      current_value,
      ratio: keyResultRatio(kr.start_value, kr.target_value, current_value),
    };
  });
  closeIfPastWindow(
    goal,
    keyResults.map((kr) => kr.ratio),
  );
  // A settled Goal reports its frozen snapshot, never a live recomputation.
  const score =
    goal.status === "active" ? meanRatio(keyResults.map((kr) => kr.ratio)) : goal.final_score;
  return { ...goal, key_results: keyResults, score };
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
  goals = [],
  focusSessions = [],
  timers = [],
  loggedIn = true,
  users = [FAKE_ADMIN],
  sessionUserId,
  apiTokens = [],
  googleConfigured = false,
  googleClientId = null,
  googleClientSecretSet = false,
  googleAccounts = [],
  googleCalendars = [],
  githubTokens = [],
  githubTokenIdentities = {},
  githubUnavailable = false,
  githubReadableRepositories = {},
  watchedRepositories = [],
  githubRepositoryFailures = {},
  githubPullRequests = [],
  githubPullRequestOverflow = {},
  githubIssues = [],
  githubIssueOverflow = {},
  repositoryViews = [],
  githubFetchedAt = null,
  githubStaleOwners = [],
  events = [],
  eventFailures = [],
  standupEntries = [],
  standupYesterdaySuggestions = [],
  standupEnabled = true,
  nowEnabled = false,
  nowTaskId = null,
  nowNote = null,
  nowShortlist = [],
  sectionSettings = { calendar: true, goals: true, habits: true, focus: true, assistant: true },
  activeHours = { enabled: false, start: "09:00", end: "17:00" },
  planningWindow = { enabled: false, start: "09:00", end: "17:00" },
  gentleReturn = false,
  reminderNotifications = false,
  reminderDeviceEnabled = reminderNotifications,
  dueReminders = [],
  quietHours = { enabled: false, start: "22:00", end: "07:00" },
  quietHoursError = null,
  heldReminders = [],
  quietUntil = null,
  missedReminders = [],
  databaseStatus = { engine: "postgresql", host: "localhost", database: "tuktuk" },
  databaseTestConnectionResult = {
    ok: true,
    version: "PostgreSQL 16.0",
    has_existing_data: false,
    reason: null,
    message: null,
  },
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
  voiceLivekitUrl = null,
  voiceLivekitApiKey = null,
  voiceSecretSet = false,
}: {
  lists?: FakeList[];
  folders?: FakeFolder[];
  sections?: FakeSection[];
  tags?: FakeTag[];
  tasks?: FakeTask[];
  completedOccurrences?: FakeCompletedOccurrence[];
  habits?: FakeHabit[];
  checkIns?: FakeCheckIn[];
  goals?: FakeGoal[];
  focusSessions?: FakeFocusSession[];
  timers?: FakeTimer[];
  /** Start unauthenticated: every non-auth route is rejected until a fake
   * login succeeds. */
  loggedIn?: boolean;
  /** The instance's accounts; `[]` starts on a fresh install that needs
   * setup. Defaults to FAKE_ADMIN alone. */
  users?: FakeUser[];
  /** Whose session `loggedIn` starts with; defaults to the first user. */
  sessionUserId?: number;
  /** API tokens of any user (#413); see `fakeApiToken`. */
  apiTokens?: FakeApiToken[];
  /** Absent (false) by default, matching the backend's default-off gate. */
  googleConfigured?: boolean;
  googleClientId?: string | null;
  googleClientSecretSet?: boolean;
  googleAccounts?: FakeGoogleAccount[];
  /** Pre-seeded as if already fetched once — the fake never re-derives
   * this from a Google-side `selected` flag; that seeding rule is the
   * backend's, exercised in the backend suite. */
  googleCalendars?: FakeGoogleCalendar[];
  githubTokens?: FakeGitHubToken[];
  githubTokenIdentities?: Record<string, FakeGitHubIdentity>;
  githubUnavailable?: boolean;
  githubReadableRepositories?: Record<string, FakeReadableRepository[]>;
  /** Seeds Watched Repositories; `id`, `private` and `created_at` default. */
  watchedRepositories?: (Omit<FakeWatchedRepository, "id" | "private" | "created_at"> &
    Partial<FakeWatchedRepository>)[];
  githubRepositoryFailures?: Record<string, "unavailable" | "needs_reconnect">;
  githubPullRequests?: FakeGitHubPullRequest[];
  githubPullRequestOverflow?: Record<string, number>;
  githubIssues?: FakeGitHubIssue[];
  githubIssueOverflow?: Record<string, number>;
  repositoryViews?: FakeRepositoryView[];
  githubFetchedAt?: string | null;
  githubStaleOwners?: string[];
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
  /** The Stand-up visibility toggle (issue #140). Defaults to true, matching
   * the backend's server-defaulted-true column. */
  standupEnabled?: boolean;
  /** Now (issue #547): off by default, nothing selected. */
  nowEnabled?: boolean;
  nowTaskId?: number | null;
  nowNote?: string | null;
  /** The Now shortlist's Task ids, in order (issue #551). */
  nowShortlist?: number[];
  /** The Calendar/Goals/Habits/Focus/Assistant visibility toggles (this
   * feature). Defaults to all-true, matching the backend's default. */
  sectionSettings?: {
    calendar: boolean;
    goals: boolean;
    habits: boolean;
    focus: boolean;
    assistant: boolean;
  };
  /** Active hours (issue #210) -- the Calendar's double-height band.
   * Defaults to disabled, matching the backend. */
  activeHours?: { enabled: boolean; start: string; end: string };
  /** Planning window (issue #563). Defaults to off, matching the backend. */
  planningWindow?: { enabled: boolean; start: string; end: string };
  /** Gentle return (issue #548). Defaults to off, matching the backend. */
  gentleReturn?: boolean;
  /** Reminder notifications (issue #557). Defaults to off, matching the backend. */
  reminderNotifications?: boolean;
  /** Whether this browser was enabled for them ("Enable on this device"),
   * kept in its localStorage. Defaults to `reminderNotifications`: false
   * plays another device, where the User opted in but not here. */
  reminderDeviceEnabled?: boolean;
  /** Reminders due now, handed out by the claim endpoint (issue #561). */
  dueReminders?: FakeReminderClaim[];
  /** Quiet hours (issue #567). Defaults to off, 22:00-07:00, like the backend. */
  quietHours?: { enabled: boolean; start: string; end: string };
  /** When set, every Quiet hours save is refused with this message. */
  quietHoursError?: string | null;
  /** What claims list as held by Quiet hours, and the band's end. */
  heldReminders?: FakeHeldReminder[];
  quietUntil?: string | null;
  /** Reminders already missed, listed by the missed endpoint (issue #565). */
  missedReminders?: FakeMissedReminder[];
  /** Settings > Database (issue #256). Defaults to a local PostgreSQL;
   * databaseTestConnectionResult is what every
   * test-connection POST answers with, regardless of the submitted URL. */
  databaseStatus?: DatabaseStatus;
  databaseTestConnectionResult?: DatabaseTestConnectionResult;
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
  /** The saved Voice Assistant config (ADR 0015, issue #366). */
  voiceLivekitUrl?: string | null;
  voiceLivekitApiKey?: string | null;
  voiceSecretSet?: boolean;
} = {}): FakeApiState {
  // This browser's own "Enable on this device" flag (#557 review): kept in
  // localStorage, which outlives a test, so every install sets it afresh.
  if (reminderDeviceEnabled) localStorage.setItem(DEVICE_OPT_IN_KEY, "true");
  else localStorage.removeItem(DEVICE_OPT_IN_KEY);
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
    goals: goals.map((goal) => ({ ...goal })),
    focusSessions: focusSessions.map((focusSession) => ({ ...focusSession })),
    timers: timers.map((timer) => ({ ...timer })),
    requests: [],
    failTaskRead: null,
    taskReadGate: null,
    failRead: null,
    readGate: null,
    failWrite: null,
    loseWriteResponse: null,
    writeGate: null,
    loggedIn,
    users: users.map((account) => ({ ...account })),
    sessionUserId: sessionUserId ?? users[0]?.id ?? 0,
    apiTokens: apiTokens.map((token) => ({ ...token })),
    googleConfigured,
    googleClientId,
    googleClientSecretSet,
    googleAccounts: googleAccounts.map((account) => ({ ...account })),
    googleCalendars: googleCalendars.map((calendar) => ({ ...calendar })),
    githubTokens: githubTokens.map((token) => ({ ...token })),
    githubTokenIdentities: { ...githubTokenIdentities },
    githubUnavailable,
    githubReadableRepositories: Object.fromEntries(
      Object.entries(githubReadableRepositories).map(([owner, repos]) => [
        owner,
        repos.map((repo) => ({ ...repo })),
      ]),
    ),
    watchedRepositories: watchedRepositories.map((watched) => ({
      id: nextWatchedRepositoryId++,
      private: true,
      created_at: "2026-01-01T00:00:00Z",
      ...watched,
    })),
    githubRepositoryFailures: { ...githubRepositoryFailures },
    githubPullRequests: githubPullRequests.map((pr) => ({
      ...pr,
      labels: pr.labels.map((label) => ({ ...label })),
    })),
    githubPullRequestOverflow: { ...githubPullRequestOverflow },
    githubIssues: githubIssues.map((issue) => ({
      ...issue,
      assignees: [...issue.assignees],
      labels: issue.labels.map((label) => ({ ...label })),
    })),
    githubIssueOverflow: { ...githubIssueOverflow },
    repositoryViews: repositoryViews.map((view) => ({
      ...view,
      watched_repository_ids: [...view.watched_repository_ids],
    })),
    githubFetchedAt,
    githubStaleOwners: [...githubStaleOwners],
    events: events.map((event) => ({ ...event })),
    eventFailures: eventFailures.map((failure) => ({ ...failure })),
    standupEntries: standupEntries.map((entry) => ({
      ...entry,
      bullets: entry.bullets.map((bullet) => ({ ...bullet })),
    })),
    standupYesterdaySuggestions: standupYesterdaySuggestions.map((suggestion) => ({
      ...suggestion,
    })),
    standupEnabled,
    nowEnabled,
    nowTaskId,
    nowNote,
    nowShortlist: nowShortlist.map((taskId) => ({ taskId })),
    sectionSettings: { ...sectionSettings },
    activeHours: { ...activeHours },
    planningWindow: { ...planningWindow },
    gentleReturn,
    reminderNotifications,
    reminderClaims: dueReminders.map((claim) => ({ ...claim })),
    reminderReports: [],
    reminderSnoozes: [],
    quietHours: { ...quietHours },
    heldReminders: heldReminders.map((held) => ({ ...held })),
    quietUntil,
    missedReminders: missedReminders.map((entry) => ({ ...entry })),
    missedDismissals: [],
    missedSnoozes: [],
    databaseStatus: { ...databaseStatus },
    databaseTestConnectionResult: { ...databaseTestConnectionResult },
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
    voiceLivekitUrl,
    voiceLivekitApiKey,
    voiceSecretSet,
  };

  const voiceConfig = (): object => ({
    livekit_url: state.voiceLivekitUrl,
    livekit_api_key: state.voiceLivekitApiKey,
    livekit_api_secret_set: state.voiceSecretSet,
    configured:
      state.voiceLivekitUrl !== null && state.voiceLivekitApiKey !== null && state.voiceSecretSet,
  });

  const handedOut = new Set<number>();
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

  const unprocessable = (code: string, message: string): Response =>
    json({ error: { code, message } }, 422);

  /** The account this browser's session belongs to, if it has one. */
  const sessionUser = (): FakeUser | undefined =>
    state.loggedIn ? state.users.find((account) => account.id === state.sessionUserId) : undefined;

  /** The signed-in User's API tokens (#413), mirrored: list (live ones,
   * newest first), create (the value in this response only) and revoke (404
   * for an unknown, another user's or an already revoked token). Null for a
   * path it doesn't own. Runs after the session middleware. */
  const apiTokensRoute = (method: string, url: URL, body: unknown): Response | null => {
    const owner = sessionUser() as FakeUser;
    if (method === "GET" && url.pathname === "/api/v1/auth/me/tokens") {
      const limit = Number(url.searchParams.get("limit") ?? "50");
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const live = state.apiTokens
        .filter((token) => token.owner_id === owner.id && token.revoked_at === null)
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
      return json({
        items: live.slice(offset, offset + limit).map(apiTokenRecord),
        total: live.length,
        limit,
        offset,
      });
    }
    if (method === "POST" && url.pathname === "/api/v1/auth/me/tokens") {
      const name = ((body as { name?: unknown }).name ?? "").toString().trim();
      if (name === "" || name.length > MAX_TOKEN_NAME_LENGTH) {
        return unprocessable(
          "invalid_token_name",
          `Token name must be 1 to ${MAX_TOKEN_NAME_LENGTH} characters`,
        );
      }
      const kind = (body as { kind?: unknown }).kind ?? "api";
      if (kind !== "api" && kind !== "mcp") {
        return unprocessable("validation_error", "kind must be api or mcp");
      }
      const created = fakeApiToken(owner.id, name, {
        created_at: new Date().toISOString(),
        kind,
      });
      state.apiTokens.push(created);
      return json({ ...apiTokenRecord(created), token: created.token }, 201);
    }
    const match = /^\/api\/v1\/auth\/me\/tokens\/(\d+)$/.exec(url.pathname);
    if (method === "DELETE" && match !== null) {
      const target = state.apiTokens.find(
        (token) =>
          token.id === Number(match[1]) && token.owner_id === owner.id && token.revoked_at === null,
      );
      if (target === undefined) {
        return notFound(`API token ${match[1]} not found`);
      }
      target.revoked_at = new Date().toISOString();
      return new Response(null, { status: 204 });
    }
    return null;
  };

  /** Unwatching a repository, or removing its GitHub Token, drops it from
   * every Repository View (#580). */
  const dropUnwatchedFromViews = (): void => {
    for (const view of state.repositoryViews) {
      view.watched_repository_ids = view.watched_repository_ids.filter((id) =>
        state.watchedRepositories.some((w) => w.id === id),
      );
    }
  };

  /** Repository Views (#580), mirrored: list in sidebar order, create
   * (last), read, update (any field) and delete. Null for a path it
   * doesn't own. */
  const repositoryViewsRoute = (method: string, url: URL, body: unknown): Response | null => {
    if (url.pathname === "/api/v1/github/views") {
      if (method === "GET") {
        return json(
          [...state.repositoryViews].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
        );
      }
      if (method === "POST") {
        const input = body as { name: string; watched_repository_ids?: number[] };
        const last = Math.max(0, ...state.repositoryViews.map((v) => v.sort_order));
        const created = fakeRepositoryView(
          input.name,
          [...(input.watched_repository_ids ?? [])].sort((a, b) => a - b),
          { sort_order: last + 1024 },
        );
        state.repositoryViews.push(created);
        return json(created, 201);
      }
      return null;
    }
    const match = /^\/api\/v1\/github\/views\/(\d+)$/.exec(url.pathname);
    if (match === null) return null;
    const id = Number(match[1]);
    const view = state.repositoryViews.find((v) => v.id === id);
    if (view === undefined) return notFound(`Repository View ${id} not found`);
    if (method === "GET") return json(view);
    if (method === "PATCH") {
      const changes = body as Partial<FakeRepositoryView>;
      Object.assign(view, changes);
      if (changes.watched_repository_ids !== undefined) {
        view.watched_repository_ids = [...changes.watched_repository_ids].sort((a, b) => a - b);
      }
      return json(view);
    }
    if (method === "DELETE") {
      state.repositoryViews = state.repositoryViews.filter((v) => v.id !== id);
      return new Response(null, { status: 204 });
    }
    return null;
  };

  /** GitHub Tokens (#578), mirrored: list, add (validated against
   * `githubTokenIdentities`, one per owner) and remove; and the Watched
   * Repositories picker (#581): readable repositories deduplicated across
   * tokens, watch and unwatch. Null for a path it doesn't own. */
  const githubRoute = (method: string, url: URL, body: unknown): Response | null => {
    // GitHub logins are case-insensitive; one GitHub Token per owner.
    const ownerTaken = (login: string, but?: number): boolean =>
      state.githubTokens.some(
        (t) => t.id !== but && t.owner_login?.toLowerCase() === login.toLowerCase(),
      );
    const viewsResponse = repositoryViewsRoute(method, url, body);
    if (viewsResponse !== null) return viewsResponse;
    if (method === "GET" && url.pathname === "/api/v1/github/tokens") {
      return json([...state.githubTokens].sort((a, b) => a.id - b.id));
    }
    if (method === "POST" && url.pathname === "/api/v1/github/tokens") {
      const token = ((body as { token?: unknown }).token ?? "").toString().trim();
      if (!token.startsWith("github_pat_")) {
        return unprocessable(
          "github_token_not_fine_grained",
          "tuk-tuk accepts only fine-grained personal access tokens (they start with github_pat_).",
        );
      }
      if (state.githubUnavailable) {
        return json(
          {
            error: {
              code: "github_unavailable",
              message:
                "GitHub could not be reached to check this token. Nothing was saved; try again in a moment.",
            },
          },
          502,
        );
      }
      const identity = state.githubTokenIdentities[token];
      if (identity === undefined) {
        return unprocessable(
          "github_token_rejected",
          "GitHub rejected this token: it may be mistyped, expired or revoked.",
        );
      }
      const login = identity.owner_login;
      if (login !== null && ownerTaken(login)) {
        return json(
          {
            error: {
              code: "github_token_owner_exists",
              message: `You already have a GitHub Token for ${login}. Remove it first to use a different one.`,
            },
          },
          409,
        );
      }
      const created = fakeGitHubToken(login, {
        owner_kind: login === null ? null : (identity.owner_kind ?? "user"),
        expires_at: identity.expires_at ?? null,
        created_at: new Date().toISOString(),
      });
      state.githubTokens.push(created);
      return json(created, 201);
    }
    const match = /^\/api\/v1\/github\/tokens\/(\d+)$/.exec(url.pathname);
    if (method === "PATCH" && match !== null) {
      // Reconnect (#584): validated like a new token, for the same owner.
      const id = Number(match[1]);
      const existing = state.githubTokens.find((t) => t.id === id);
      if (existing === undefined) {
        return notFound(`GitHub Token ${id} not found`);
      }
      const token = String((body as { token?: unknown }).token ?? "").trim();
      if (!token.startsWith("github_pat_")) {
        return unprocessable(
          "github_token_not_fine_grained",
          "tuk-tuk accepts only fine-grained personal access tokens (they start with github_pat_).",
        );
      }
      const identity = state.githubTokenIdentities[token];
      if (identity === undefined) {
        return unprocessable(
          "github_token_rejected",
          "GitHub rejected this token: it may be mistyped, expired or revoked.",
        );
      }
      const login = identity.owner_login;
      if (existing.owner_login === null) {
        if (login !== null) {
          if (ownerTaken(login, id)) {
            return json(
              {
                error: {
                  code: "github_token_owner_exists",
                  message: `You already have a GitHub Token for ${login}. Reconnect it to use a different one.`,
                },
              },
              409,
            );
          }
          existing.owner_login = login;
          existing.owner_kind = identity.owner_kind ?? "user";
        }
      } else if (login === null) {
        return unprocessable(
          "github_token_owner_unknown",
          "GitHub cannot tell which owner this token is for until it can read a repository. " +
            `If ${existing.owner_login} must allow or approve fine-grained tokens, try again once it has.`,
        );
      } else if (login.toLowerCase() !== existing.owner_login.toLowerCase()) {
        return unprocessable(
          "github_token_owner_mismatch",
          `This token grants access to ${login}, not ${existing.owner_login}. ` +
            `Paste a token for ${existing.owner_login}, or add it as a new GitHub Token.`,
        );
      }
      existing.expires_at = identity.expires_at ?? null;
      existing.expires_soon = false;
      existing.connection_state = "connected";
      // The replacement works where the old token no longer did.
      delete state.githubRepositoryFailures[existing.owner_login ?? ""];
      return json(existing);
    }
    if (method === "DELETE" && match !== null) {
      const id = Number(match[1]);
      if (!state.githubTokens.some((t) => t.id === id)) {
        return notFound(`GitHub Token ${id} not found`);
      }
      state.githubTokens = state.githubTokens.filter((t) => t.id !== id);
      // A GitHub Token's Watched Repositories go with it.
      state.watchedRepositories = state.watchedRepositories.filter((w) => w.github_token_id !== id);
      dropUnwatchedFromViews();
      return new Response(null, { status: 204 });
    }
    // A token whose owner isn't known yet reads nothing.
    const readable = (token: FakeGitHubToken): FakeReadableRepository[] =>
      token.owner_login === null || token.owner_login in state.githubRepositoryFailures
        ? []
        : (state.githubReadableRepositories[token.owner_login] ?? []);
    if (method === "GET" && url.pathname === "/api/v1/github/repositories") {
      // Offered once per GitHub repository id, through the first token that
      // reads it, or the token it is already watched through.
      const offered = new Map<number, unknown>();
      const tokens = [...state.githubTokens].sort((a, b) => a.id - b.id);
      for (const token of tokens) {
        for (const repo of readable(token)) {
          if (offered.has(repo.github_repo_id)) continue;
          const watched = state.watchedRepositories.find(
            (w) => w.github_repo_id === repo.github_repo_id,
          );
          offered.set(repo.github_repo_id, {
            github_repo_id: repo.github_repo_id,
            full_name: repo.full_name,
            private: repo.private ?? true,
            github_token_id: watched?.github_token_id ?? token.id,
            watched_repository_id: watched?.id ?? null,
          });
        }
      }
      return json({
        repositories: [...offered.values()],
        tokens: tokens.map((token) => ({
          id: token.id,
          owner_login: token.owner_login,
          status: state.githubRepositoryFailures[token.owner_login ?? ""] ?? "ok",
          repository_count: readable(token).length,
        })),
      });
    }
    if (method === "GET" && url.pathname === "/api/v1/github/watched-repositories") {
      return json(
        [...state.watchedRepositories].sort((a, b) =>
          a.full_name.toLowerCase().localeCompare(b.full_name.toLowerCase()),
        ),
      );
    }
    if (method === "POST" && url.pathname === "/api/v1/github/watched-repositories") {
      const { github_token_id, github_repo_id } = body as {
        github_token_id: number;
        github_repo_id: number;
      };
      const token = state.githubTokens.find((t) => t.id === github_token_id);
      if (token === undefined) {
        return notFound(`GitHub Token ${github_token_id} not found`);
      }
      const already = state.watchedRepositories.find((w) => w.github_repo_id === github_repo_id);
      if (already !== undefined) {
        return json(
          {
            error: {
              code: "github_repository_already_watched",
              message: `You already watch ${already.full_name}.`,
            },
          },
          409,
        );
      }
      const repo = readable(token).find((r) => r.github_repo_id === github_repo_id);
      if (repo === undefined) {
        return unprocessable(
          "github_repository_not_readable",
          `The GitHub Token for ${token.owner_login} cannot read that repository.`,
        );
      }
      const created: FakeWatchedRepository = {
        id: nextWatchedRepositoryId++,
        github_token_id,
        github_repo_id,
        full_name: repo.full_name,
        private: repo.private ?? true,
        created_at: new Date().toISOString(),
      };
      state.watchedRepositories.push(created);
      return json(created, 201);
    }
    const githubViewRead = (
      items: readonly { repository: string }[],
      overflowByName: Record<string, number>,
      listPath: "pulls" | "issues",
    ): Response => {
      // Shaped as the backend answers: only Watched Repositories (only a
      // Repository View's, given `?view=`), each with its overflow, and a
      // status for each token that has any.
      const viewParam = url.searchParams.get("view");
      const view =
        viewParam === null ? null : state.repositoryViews.find((v) => v.id === Number(viewParam));
      if (view === undefined) return notFound(`Repository View ${viewParam} not found`);
      const watched = [...state.watchedRepositories]
        .filter((w) => view === null || view.watched_repository_ids.includes(w.id))
        .sort((a, b) => a.full_name.localeCompare(b.full_name));
      // A token GitHub fails to read through hides only its own
      // repositories; one GitHub rejects needs reconnection (#584).
      const failing = (tokenId: number): "unavailable" | "needs_reconnect" | undefined => {
        const token = state.githubTokens.find((t) => t.id === tokenId);
        return token === undefined
          ? undefined
          : state.githubRepositoryFailures[token.owner_login ?? ""];
      };
      for (const token of state.githubTokens) {
        if (state.githubRepositoryFailures[token.owner_login ?? ""] === "needs_reconnect") {
          token.connection_state = "needs_reconnect";
        }
      }
      const byName = new Map(
        watched
          .filter((w) => failing(w.github_token_id) === undefined)
          .map((w) => [w.full_name, w]),
      );
      const readTokens = [...state.githubTokens]
        .sort((a, b) => a.id - b.id)
        .filter((token) => watched.some((w) => w.github_token_id === token.id));
      // A token GitHub couldn't be reached through still shows its last
      // result when it has a recent one: stale (#583).
      const tokenStatus = (token: FakeGitHubToken): GitHubTokenReadStatus["status"] =>
        state.githubRepositoryFailures[token.owner_login ?? ""] ??
        (state.githubStaleOwners.includes(token.owner_login ?? "") ? "stale" : "ok");
      return json({
        items: items
          .filter((item) => byName.has(item.repository))
          .map((item) => ({ ...item, watched_repository_id: byName.get(item.repository)?.id })),
        repositories: [...byName.values()].map((w) => {
          const overflow = overflowByName[w.full_name] ?? 0;
          const shown = items.filter((item) => item.repository === w.full_name).length;
          return {
            watched_repository_id: w.id,
            full_name: w.full_name,
            total_count: shown + overflow,
            overflow_count: overflow,
            overflow_url: `https://github.com/${w.full_name}/${listPath}`,
          };
        }),
        tokens: readTokens.map((token) => ({
          id: token.id,
          owner_login: token.owner_login,
          status: tokenStatus(token),
          expires_at: token.expires_at,
          expires_soon: token.expires_soon,
        })),
        fetched_at: state.githubFetchedAt ?? new Date().toISOString(),
        stale: readTokens.some((token) => tokenStatus(token) === "stale"),
      });
    };
    if (method === "GET" && url.pathname === "/api/v1/github/pull-requests") {
      return githubViewRead(state.githubPullRequests, state.githubPullRequestOverflow, "pulls");
    }
    if (method === "GET" && url.pathname === "/api/v1/github/issues") {
      return githubViewRead(state.githubIssues, state.githubIssueOverflow, "issues");
    }
    const watchedMatch = /^\/api\/v1\/github\/watched-repositories\/(\d+)$/.exec(url.pathname);
    if (method === "DELETE" && watchedMatch !== null) {
      const id = Number(watchedMatch[1]);
      if (!state.watchedRepositories.some((w) => w.id === id)) {
        return notFound(`Watched Repository ${id} not found`);
      }
      state.watchedRepositories = state.watchedRepositories.filter((w) => w.id !== id);
      dropUnwatchedFromViews();
      return new Response(null, { status: 204 });
    }
    return null;
  };

  /** The admin users API (#412), mirrored: list, create, update (with the
   * last-admin guard) and reset password. Null for a path it doesn't own.
   * Runs after the session middleware, so the caller is signed in. */
  const adminUsersRoute = (method: string, url: URL, body: unknown): Response | null => {
    const actor = sessionUser() as FakeUser;
    if (!actor.is_admin) {
      return json({ error: { code: "admin_required", message: "Admin rights are required" } }, 403);
    }
    if (method === "GET" && url.pathname === "/api/v1/admin/users") {
      const limit = Number(url.searchParams.get("limit") ?? "50");
      const offset = Number(url.searchParams.get("offset") ?? "0");
      if (!Number.isInteger(limit) || limit < 1 || limit > 200 || offset < 0) {
        return unprocessable("validation_error", "Request validation failed");
      }
      const ordered = [...state.users].sort((a, b) => a.id - b.id);
      return json({
        items: ordered.slice(offset, offset + limit).map(adminUserRecord),
        total: ordered.length,
        limit,
        offset,
      });
    }
    if (method === "POST" && url.pathname === "/api/v1/admin/users") {
      const input = body as {
        username: string;
        email: string;
        temp_password: string;
        is_admin?: boolean;
      };
      const username = input.username.trim();
      if (username === "" || username.length > MAX_USERNAME_LENGTH) {
        return unprocessable(
          "invalid_username",
          `Username must be 1 to ${MAX_USERNAME_LENGTH} characters`,
        );
      }
      const email = input.email.trim();
      if (!EMAIL_PATTERN.test(email)) {
        return unprocessable("invalid_email", "Enter a valid email address");
      }
      if (input.temp_password.length < MIN_PASSWORD_LENGTH) {
        return unprocessable(
          "invalid_password",
          `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        );
      }
      const conflict = identityConflict(state.users, null, username, email);
      if (conflict !== null) {
        return conflict;
      }
      const created = fakeUser(username, {
        email,
        is_admin: input.is_admin ?? false,
        password: input.temp_password,
        must_change_password: true,
        created_at: new Date().toISOString(),
        password_changed_at: new Date().toISOString(),
      });
      state.users.push(created);
      return json(adminUserRecord(created), 201);
    }
    const match = /^\/api\/v1\/admin\/users\/(\d+)(\/reset-password)?$/.exec(url.pathname);
    if (match === null) {
      return null;
    }
    const target = state.users.find((account) => account.id === Number(match[1]));
    const isReset = match[2] !== undefined;
    if (method === "PATCH" && !isReset) {
      if (target === undefined) {
        return notFound(`User ${match[1]} not found`);
      }
      const input = body as { is_active?: boolean; is_admin?: boolean };
      const losesAdmin =
        target.is_admin &&
        target.is_active &&
        (input.is_admin === false || input.is_active === false);
      const otherActiveAdmin = state.users.some(
        (account) => account !== target && account.is_admin && account.is_active,
      );
      if (losesAdmin && !otherActiveAdmin) {
        return json(
          {
            error: {
              code: "last_admin",
              message: "The last active admin cannot be demoted or disabled",
            },
          },
          409,
        );
      }
      // Disabling ends the account's sessions; the session middleware then
      // answers its next request 401 account_disabled.
      if (input.is_active !== undefined) {
        target.is_active = input.is_active;
      }
      if (input.is_admin !== undefined) {
        target.is_admin = input.is_admin;
      }
      return json(adminUserRecord(target));
    }
    if (method === "POST" && isReset) {
      // The backend's order: an unknown account before the password rule.
      if (target === undefined) {
        return notFound(`User ${match[1]} not found`);
      }
      const input = body as { temp_password: string };
      if (input.temp_password.length < MIN_PASSWORD_LENGTH) {
        return unprocessable(
          "invalid_password",
          `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        );
      }
      target.password = input.temp_password;
      target.must_change_password = true;
      target.password_changed_at = new Date().toISOString();
      // A reset is how a User who forgot their password gets back in.
      target.login_locked = false;
      // A new password ends every session of that account (epoch bump).
      if (target.id === state.sessionUserId) {
        state.loggedIn = false;
      }
      return json(adminUserRecord(target));
    }
    return null;
  };

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
      // The plan belongs to the occurrence being completed (#558).
      task.planned_work = null;
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

  const handle = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    state.requests.push({ method, url: url.pathname + url.search, body });
    if (method === "GET" && state.readGate?.match(url.pathname) === true) {
      await state.readGate.gate;
    }
    if (method === "GET" && state.failRead?.(url.pathname) === true) {
      return json({ error: { code: "internal_error", message: "Unavailable" } }, 500);
    }
    if (method !== "GET" && state.writeGate?.match(method, url.pathname) === true) {
      await state.writeGate.gate;
    }
    if (method !== "GET" && state.failWrite?.(method, url.pathname) === true) {
      return json({ error: { code: "internal_error", message: "Unavailable" } }, 500);
    }

    // Public routes, then the backend's session middleware (ADR 0018):
    // no session, a disabled account, or a pending forced step stops the
    // request before any other route sees it.
    if (method === "POST" && url.pathname === "/api/v1/auth/setup") {
      if (state.users.length > 0) {
        return notFound("Setup has already been completed");
      }
      const input = body as { username: string; email: string; password: string };
      const username = input.username.trim();
      if (username === "" || username.length > MAX_USERNAME_LENGTH) {
        return unprocessable(
          "invalid_username",
          `Username must be 1 to ${MAX_USERNAME_LENGTH} characters`,
        );
      }
      const email = input.email.trim();
      if (!EMAIL_PATTERN.test(email)) {
        return unprocessable("invalid_email", "Enter a valid email address");
      }
      if (input.password.length < MIN_PASSWORD_LENGTH) {
        return unprocessable(
          "invalid_password",
          `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        );
      }
      const admin = fakeUser(username, { email, is_admin: true, password: input.password });
      state.users.push(admin);
      state.loggedIn = true;
      state.sessionUserId = admin.id;
      return new Response(null, { status: 204 });
    }
    // The backend's order: the body's shape (FastAPI validates it before the
    // handler runs), setup, an unknown login, that account's lockout, and
    // only then the password; a disabled account learns so only with the
    // right one.
    if (method === "POST" && url.pathname === "/api/v1/auth/login") {
      const input = body as { login?: unknown; password?: unknown };
      if (typeof input.login !== "string" || typeof input.password !== "string") {
        return unprocessable("validation_error", "Request validation failed");
      }
      if (state.users.length === 0) {
        return notFound("Setup has not been completed");
      }
      // Username and email are citext on the backend: case never matters.
      const login = input.login.trim().toLowerCase();
      const account = state.users.find(
        (candidate) =>
          candidate.username.toLowerCase() === login || candidate.email?.toLowerCase() === login,
      );
      // One body for an unknown login and a wrong password, so the response
      // never reveals who has an account.
      const invalid = (): Response =>
        json(
          { error: { code: "invalid_credentials", message: "Incorrect login or password" } },
          401,
        );
      if (account === undefined) {
        return invalid();
      }
      if (account.login_locked === true) {
        return new Response(
          JSON.stringify({
            error: { code: "too_many_attempts", message: "Too many attempts. Try again later." },
          }),
          { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "30" } },
        );
      }
      if (input.password !== account.password) {
        return invalid();
      }
      if (!account.is_active) {
        return json(
          { error: { code: "account_disabled", message: "This account is disabled" } },
          403,
        );
      }
      state.loggedIn = true;
      state.sessionUserId = account.id;
      return new Response(null, { status: 204 });
    }
    if (url.pathname.startsWith("/api/")) {
      const account = sessionUser();
      if (account === undefined) {
        return state.users.length === 0 ? setupRequired() : unauthorized();
      }
      if (!account.is_active) {
        return json(
          { error: { code: "account_disabled", message: "This account is disabled" } },
          401,
        );
      }
      // 403, not 401: the session is valid, just not usable until the step
      // is done — so the frontend's log-out-on-401 listener leaves it be.
      if (!FORCED_STEP_ROUTES.has(`${method} ${url.pathname}`)) {
        if (account.must_complete_profile) {
          return json(
            {
              error: {
                code: "profile_completion_required",
                message: "Complete your profile to continue",
              },
            },
            403,
          );
        }
        if (account.must_change_password) {
          return json(
            {
              error: {
                code: "password_change_required",
                message: "Choose a new password to continue",
              },
            },
            403,
          );
        }
      }
      // Served from here on: the account was active now, recorded at most
      // once per interval like the backend middleware.
      const now = Date.now();
      if (
        account.last_active_at === null ||
        now - Date.parse(account.last_active_at) >= LAST_ACTIVE_WRITE_INTERVAL_MS
      ) {
        account.last_active_at = new Date(now).toISOString();
      }
    }
    if (method === "GET" && url.pathname === "/api/v1/auth/me") {
      return json(currentUserRecord(sessionUser() as FakeUser));
    }
    if (method === "PATCH" && url.pathname === "/api/v1/auth/me") {
      // The signed-in User's own profile edit (#474): only the fields sent
      // change, under the same rules as account creation.
      const account = sessionUser() as FakeUser;
      const input = body as { username?: string; email?: string };
      const username = input.username?.trim();
      if (username !== undefined && (username === "" || username.length > MAX_USERNAME_LENGTH)) {
        return unprocessable(
          "invalid_username",
          `Username must be 1 to ${MAX_USERNAME_LENGTH} characters`,
        );
      }
      const email = input.email?.trim();
      if (email !== undefined && !EMAIL_PATTERN.test(email)) {
        return unprocessable("invalid_email", "Enter a valid email address");
      }
      const conflict = identityConflict(state.users, account, username, email);
      if (conflict !== null) {
        return conflict;
      }
      if (username !== undefined) {
        account.username = username;
      }
      if (email !== undefined) {
        account.email = email;
      }
      return json(currentUserRecord(account));
    }
    if (
      url.pathname === "/api/v1/auth/me/tokens" ||
      url.pathname.startsWith("/api/v1/auth/me/tokens/")
    ) {
      const tokenResponse = apiTokensRoute(method, url, body);
      if (tokenResponse !== null) {
        return tokenResponse;
      }
    }
    if (url.pathname.startsWith("/api/v1/github/")) {
      const githubResponse = githubRoute(method, url, body);
      if (githubResponse !== null) {
        return githubResponse;
      }
    }
    if (url.pathname.startsWith("/api/v1/admin/")) {
      // Admin account management (#412). The admin-users store is
      // `state.users` itself; every endpoint is for Admins only.
      const adminResponse = adminUsersRoute(method, url, body);
      if (adminResponse !== null) {
        return adminResponse;
      }
    }
    if (method === "GET" && url.pathname === "/api/v1/auth/session") {
      return new Response(null, { status: 204 });
    }
    if (method === "POST" && url.pathname === "/api/v1/auth/logout") {
      state.loggedIn = false;
      return new Response(null, { status: 204 });
    }
    // Mirrors the backend's /auth/complete (auth router, ADR 0018) for both
    // forced steps, in the backend's order: profile validation, password
    // length, unchanged password, then identity conflicts.
    if (method === "POST" && url.pathname === "/api/v1/auth/complete") {
      const account = sessionUser() as FakeUser;
      if (!account.must_change_password && !account.must_complete_profile) {
        return json(
          { error: { code: "no_pending_step", message: "There is no step to complete" } },
          409,
        );
      }
      const input = body as { new_password: string; username?: string; email?: string };
      let profile: { username: string; email: string } | null = null;
      if (account.must_complete_profile) {
        if (input.username === undefined || input.email === undefined) {
          return unprocessable(
            "profile_required",
            "Username and email are required to complete a profile",
          );
        }
        const username = input.username.trim();
        if (username === "" || username.length > MAX_USERNAME_LENGTH) {
          return unprocessable(
            "invalid_username",
            `Username must be 1 to ${MAX_USERNAME_LENGTH} characters`,
          );
        }
        const email = input.email.trim();
        if (!EMAIL_PATTERN.test(email)) {
          return unprocessable("invalid_email", "Enter a valid email address");
        }
        profile = { username, email };
      }
      if (input.new_password.length < MIN_PASSWORD_LENGTH) {
        return unprocessable(
          "invalid_password",
          `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        );
      }
      if (input.new_password === account.password) {
        return unprocessable(
          "password_unchanged",
          "Choose a password different from the current one",
        );
      }
      if (profile !== null) {
        // Username and email are citext on the backend: case never matters.
        const others = state.users.filter((candidate) => candidate.id !== account.id);
        const taken = (field: "username" | "email", value: string): boolean =>
          others.some((other) => other[field]?.toLowerCase() === value.toLowerCase());
        if (taken("username", profile.username)) {
          return json(
            { error: { code: "username_taken", message: "That username is already taken" } },
            409,
          );
        }
        if (taken("email", profile.email)) {
          return json(
            { error: { code: "email_taken", message: "That email is already in use" } },
            409,
          );
        }
        account.username = profile.username;
        account.email = profile.email;
      }
      account.password = input.new_password;
      account.password_changed_at = new Date().toISOString();
      account.must_change_password = false;
      account.must_complete_profile = false;
      return new Response(null, { status: 204 });
    }
    if (method === "POST" && url.pathname === "/api/v1/auth/password") {
      // The same per-User lockout as /login.
      const account = sessionUser() as FakeUser;
      if (account.login_locked === true) {
        return new Response(
          JSON.stringify({
            error: { code: "too_many_attempts", message: "Too many attempts. Try again later." },
          }),
          { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "30" } },
        );
      }
      const input = body as { current_password: string; new_password: string };
      if (input.current_password !== account.password) {
        return json(
          { error: { code: "invalid_current_password", message: "Current password is incorrect" } },
          400,
        );
      }
      if (input.new_password.length < MIN_PASSWORD_LENGTH) {
        return unprocessable(
          "invalid_password",
          `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        );
      }
      account.password = input.new_password;
      account.password_changed_at = new Date().toISOString();
      return new Response(null, { status: 204 });
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
    if (method === "POST" && url.pathname === "/api/v1/voice/session") {
      if (!state.loggedIn) return unauthorized();
      return json({ url: "wss://test.livekit.cloud", token: "fake-token", room: "test-room" });
    }
    if (url.pathname === "/api/v1/voice/config") {
      if (!state.loggedIn) {
        return unauthorized();
      }
      if (method === "GET") {
        return json(voiceConfig());
      }
      if (method === "PUT") {
        const input = body as {
          livekit_url?: string | null;
          livekit_api_key?: string | null;
          livekit_api_secret?: string | null;
        };
        // Mirrors the backend: omitted keeps, null/empty is 422, and the
        // first save needs a secret.
        for (const value of Object.values(input)) {
          if (value === null || value === "") {
            return json({ error: { code: "validation_error", message: "Invalid value" } }, 422);
          }
        }
        if (input.livekit_api_secret === undefined && !state.voiceSecretSet) {
          return json(
            {
              error: {
                code: "livekit_secret_required",
                message: "A LiveKit API secret is required",
              },
            },
            422,
          );
        }
        if (input.livekit_url !== undefined) {
          state.voiceLivekitUrl = input.livekit_url;
        }
        if (input.livekit_api_key !== undefined) {
          state.voiceLivekitApiKey = input.livekit_api_key;
        }
        if (input.livekit_api_secret !== undefined) {
          state.voiceSecretSet = true;
        }
        return json(voiceConfig());
      }
      if (method === "DELETE") {
        state.voiceLivekitUrl = null;
        state.voiceLivekitApiKey = null;
        state.voiceSecretSet = false;
        return new Response(null, { status: 204 });
      }
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
    if (method === "DELETE" && url.pathname === "/api/v1/tasks") {
      const listId = url.searchParams.get("list_id");
      const completed = url.searchParams.get("completed");
      if (completed !== "true") {
        return json(
          {
            error: {
              code: "validation_error",
              message: "Bulk delete requires completed=true",
            },
          },
          422,
        );
      }
      const ids = state.tasks
        .filter((task) => task.completed && (listId === null || task.list_id === Number(listId)))
        .map((task) => task.id);
      state.tasks = state.tasks.filter((task) => !ids.includes(task.id));
      state.completedOccurrences = state.completedOccurrences.filter(
        (occurrence) => !ids.includes(occurrence.task_id),
      );
      for (const focusSession of state.focusSessions) {
        if (focusSession.task_id !== null && ids.includes(focusSession.task_id)) {
          focusSession.task_id = null;
        }
      }
      for (const timer of state.timers) {
        if (timer.task_id !== null && ids.includes(timer.task_id)) {
          timer.task_id = null;
        }
      }
      return new Response(null, { status: 204 });
    }
    if (method === "GET" && url.pathname === "/api/v1/tasks") {
      if (state.taskReadGate !== null) await state.taskReadGate;
      if (state.failTaskRead?.(url.searchParams) === true) {
        return json({ error: { code: "internal_error", message: "Tasks unavailable" } }, 500);
      }
      const listId = url.searchParams.get("list_id");
      const tagId = url.searchParams.get("tag_id");
      const keyResultId = url.searchParams.get("key_result_id");
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
          (keyResultId === null || task.key_result_id === Number(keyResultId)) &&
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
        // Planned work (#562) brings its Task in too, read on the plan's own day.
        items = items.filter((task) => {
          const plan = task.planned_work ?? null;
          const planned = plan === null ? null : zonedDay(plan.start, plan.time_zone);
          if (planned !== null && rangeStart <= planned && planned <= rangeEnd) {
            return true;
          }
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
        key_result_id?: number;
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
        key_result_id: input.key_result_id ?? null,
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
        if (
          url.searchParams.get("auto_complete") !== "false" &&
          (body as { done?: boolean }).done === true &&
          task.check_items.every((i) => i.done)
        ) {
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
      if (method === "GET") {
        return json(task);
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
        // Mirror the backend's estimate rule (#563): positive whole minutes,
        // at most a week; null removes it.
        const estimate = rest.estimate_minutes;
        if (
          estimate !== undefined &&
          estimate !== null &&
          !(Number.isInteger(estimate) && Number(estimate) >= 1 && Number(estimate) <= 7 * 24 * 60)
        ) {
          return json({ error: { code: "validation_error", message: "Invalid estimate" } }, 422);
        }
        // Mirror the backend's planned work rules (#558): a positive
        // duration, kept (buffer included) within one local day.
        if (rest.planned_work !== undefined && rest.planned_work !== null) {
          const block = rest.planned_work as PlannedWork;
          const rejection = plannedWorkRejection(block);
          if (rejection !== null) {
            return json({ error: { code: "invalid_planned_work", message: rejection } }, 422);
          }
          const end = new Date(new Date(block.start).getTime() + block.duration_minutes * 60000);
          rest.planned_work = { ...block, end: `${end.toISOString().slice(0, 19)}Z` };
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
      // Like the backend, a new Habit is created now: its Habit start is today.
      const created = fakeHabit(input.name, { ...input, created_at: new Date().toISOString() });
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
        // Mirror the backend: becoming Numeric requires a target in the same
        // request, and becoming Boolean sweeps the target fields back.
        const patch = body as { type?: HabitType; target?: number };
        if (patch.type === "numeric" && habit.type === "boolean" && patch.target === undefined) {
          return json(
            {
              error: { code: "invalid_habit", message: "A Numeric habit requires a target" },
            },
            422,
          );
        }
        Object.assign(habit, body);
        if (habit.type === "boolean") {
          Object.assign(habit, { target: 1, step: 1, unit: null });
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
        // Mirror the backend: a habit_checkins Key Result stops counting
        // rather than breaking its Goal (ADR 0012, issue #235).
        for (const goal of state.goals) {
          for (const kr of goal.key_results) {
            if (kr.source_habit_id === habitId) kr.source_habit_id = null;
          }
        }
        return new Response(null, { status: 204 });
      }
    }
    if (method === "GET" && url.pathname === "/api/v1/goals") {
      const items = state.goals.map((g) => serializeGoal(g, state));
      return json({
        items,
        total: state.goals.length,
        limit: 50,
        offset: 0,
      });
    }
    if (method === "POST" && url.pathname === "/api/v1/goals") {
      const input = body as { title: string } & Partial<Omit<FakeGoal, "id" | "title">>;
      const created = fakeGoal(input.title, input);
      state.goals.push(created);
      return json(serializeGoal(created, state), 201);
    }
    const goalMatch = url.pathname.match(/^\/api\/v1\/goals\/(\d+)$/);
    if (goalMatch) {
      const goalId = Number(goalMatch[1]);
      const goal = state.goals.find((g) => g.id === goalId);
      if (!goal) {
        return notFound(`Goal ${goalId} not found`);
      }
      if (method === "GET") {
        return json(serializeGoal(goal, state));
      }
      if (method === "PATCH") {
        if ((body as { is_focused?: boolean }).is_focused === true) {
          // ADR 0012: only one Goal may be focused at a time, enforced here
          // in the same "transaction" as setting the new one.
          for (const other of state.goals) {
            if (other.id !== goalId) other.is_focused = false;
          }
        }
        const wasActive = goal.status === "active";
        Object.assign(goal, body);
        if (wasActive && goal.status !== "active") {
          settle(
            goal,
            goal.key_results.map((kr) => {
              const current = keyResultCurrentValue(kr, goal, state);
              return keyResultRatio(kr.start_value, kr.target_value, current);
            }),
          );
        }
        return json(serializeGoal(goal, state));
      }
      if (method === "DELETE") {
        state.goals = state.goals.filter((g) => g.id !== goalId);
        return new Response(null, { status: 204 });
      }
    }
    const keyResultsMatch = url.pathname.match(/^\/api\/v1\/goals\/(\d+)\/key-results$/);
    if (keyResultsMatch && method === "POST") {
      const goalId = Number(keyResultsMatch[1]);
      const goal = state.goals.find((g) => g.id === goalId);
      if (!goal) return notFound(`Goal ${goalId} not found`);
      const input = body as { name: string } & Partial<
        Omit<FakeKeyResult, "id" | "goal_id" | "name">
      >;
      goal.key_results.push(fakeKeyResult(goalId, input.name, input));
      return json(serializeGoal(goal, state), 201);
    }
    const keyResultMatch = url.pathname.match(/^\/api\/v1\/goals\/(\d+)\/key-results\/(\d+)$/);
    if (keyResultMatch) {
      const goalId = Number(keyResultMatch[1]);
      const keyResultId = Number(keyResultMatch[2]);
      const goal = state.goals.find((g) => g.id === goalId);
      if (!goal) return notFound(`Goal ${goalId} not found`);
      const kr = goal.key_results.find((k) => k.id === keyResultId);
      if (!kr) return notFound(`Key result ${keyResultId} not found on goal ${goalId}`);
      if (method === "PATCH") {
        const patch = body as Partial<FakeKeyResult>;
        if (patch.current_value !== undefined && kr.source !== "manual") {
          return json(
            {
              error: {
                code: "automatic_key_result",
                message:
                  "current_value is computed for automatic Key Results and cannot be written",
              },
            },
            409,
          );
        }
        Object.assign(kr, patch);
        return json(serializeGoal(goal, state));
      }
      if (method === "DELETE") {
        // Deleting a Key Result detaches its Tasks (mirrors the backend's
        // explicit UPDATE and ON DELETE SET NULL).
        for (const task of state.tasks) {
          if (task.key_result_id === keyResultId) task.key_result_id = null;
        }
        goal.key_results = goal.key_results.filter((k) => k.id !== keyResultId);
        return new Response(null, { status: 204 });
      }
    }
    const pausesMatch = url.pathname.match(
      /^\/api\/v1\/habits\/(\d+)\/pauses(?:\/(\d+))?(\/resume)?$/,
    );
    if (pausesMatch) {
      const habit = state.habits.find((h) => h.id === Number(pausesMatch[1]));
      if (!habit) {
        return notFound(`Habit ${pausesMatch[1]} not found`);
      }
      const pauseId = pausesMatch[2] === undefined ? null : Number(pausesMatch[2]);
      const existing = habit.pauses.find((pause) => pause.id === pauseId);
      if (pauseId !== null && !existing) {
        return notFound(`Pause ${pauseId} not found`);
      }
      if (method === "POST" && pausesMatch[3] !== undefined && existing) {
        // Mirror the backend's Resume today.
        const today = (body as { today: string }).today;
        if (existing.start_date >= today) {
          habit.pauses = habit.pauses.filter((pause) => pause !== existing);
        } else if (existing.end_date === null || existing.end_date >= today) {
          existing.end_date = addDays(today, -1);
        }
        return json(habit);
      }
      if (method === "DELETE" && existing) {
        habit.pauses = habit.pauses.filter((pause) => pause !== existing);
        return new Response(null, { status: 204 });
      }
      if (method === "POST" || method === "PATCH") {
        const input = { ...existing, ...(body as Partial<FakeHabitPause>) };
        const candidate: FakeHabitPause = {
          id: existing?.id ?? nextHabitPauseId++,
          habit_id: habit.id,
          start_date: input.start_date as string,
          end_date: input.end_date ?? null,
        };
        // Mirror the backend's rules: forwards, no overlap, no Check-ins.
        if (candidate.end_date !== null && candidate.end_date < candidate.start_date) {
          return json(
            { error: { code: "invalid_pause", message: "A pause cannot end before it starts" } },
            422,
          );
        }
        const overlaps = habit.pauses.some(
          (other) =>
            other !== existing &&
            (other.end_date === null || candidate.start_date <= other.end_date) &&
            (candidate.end_date === null || other.start_date <= candidate.end_date),
        );
        if (overlaps) {
          return json(
            { error: { code: "pause_overlaps", message: "Already paused over those dates" } },
            409,
          );
        }
        const dates = state.checkIns
          .filter((c) => c.habit_id === habit.id && pauseCovers(candidate, c.date))
          .map((c) => c.date)
          .sort();
        if (dates.length > 0) {
          return json(
            {
              error: {
                code: "pause_conflicts_with_check_ins",
                message: `Check-ins on ${dates.join(", ")} prevent this pause`,
                details: { dates },
              },
            },
            409,
          );
        }
        if (existing) {
          Object.assign(existing, candidate);
          return json(existing);
        }
        habit.pauses = [...habit.pauses, candidate].sort((a, b) =>
          a.start_date.localeCompare(b.start_date),
        );
        return json(candidate, 201);
      }
    }
    const skipMatch = url.pathname.match(/^\/api\/v1\/habits\/(\d+)\/skips\/(\d{4}-\d{2}-\d{2})$/);
    if (skipMatch) {
      const habit = state.habits.find((h) => h.id === Number(skipMatch[1]));
      if (!habit) {
        return notFound(`Habit ${skipMatch[1]} not found`);
      }
      const day = skipMatch[2] as string;
      if (method === "DELETE") {
        if (!habit.skips.includes(day)) {
          return notFound(`${day} is not skipped`);
        }
        habit.skips = habit.skips.filter((skipped) => skipped !== day);
        return new Response(null, { status: 204 });
      }
      if (method === "PUT") {
        // Mirror the backend's rules: scheduled, unpaused, no Check-in.
        if (!habitDueOn(habit.frequency, day)) {
          return json(
            { error: { code: "skip_not_scheduled", message: `Not scheduled on ${day}` } },
            422,
          );
        }
        if (habit.pauses.some((pause) => pauseCovers(pause, day))) {
          return json({ error: { code: "habit_day_paused", message: `Paused on ${day}` } }, 409);
        }
        if (state.checkIns.some((c) => c.habit_id === habit.id && c.date === day)) {
          return json(
            {
              error: {
                code: "skip_conflicts_with_check_in",
                message: `A Check-in on ${day} prevents this skip`,
                details: { dates: [day] },
              },
            },
            409,
          );
        }
        if (!habit.skips.includes(day)) {
          habit.skips = [...habit.skips, day].sort();
        }
        return json({ habit_id: habit.id, date: day });
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
      // Like the backend, the zone is required: server UTC is not the User's day.
      const tz = url.searchParams.get("tz");
      if (tz === null || !isKnownZone(tz)) {
        return json(
          { error: { code: "validation_error", message: `Unknown IANA timezone ${tz}` } },
          422,
        );
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
        // Mirror the backend: paused and skipped days (app.habit_days) are
        // stepped over like unscheduled ones, never counted.
        const earliest = [...checked].sort()[0] as string;
        while (day >= earliest) {
          const isPaused =
            habit.pauses.some((pause) => pauseCovers(pause, day)) || habit.skips.includes(day);
          if (habitDueOn(habit.frequency, day) && !(isPaused && !checked.has(day))) {
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
          intensity: Math.min(checkIn.value / habit.target, 1),
        }));
      // Mirror the backend's Habit start: the creation day in `tz`, pulled
      // back to an earlier real Check-in, and never after today.
      const eligibleFrom = [zonedDay(habit.created_at, tz), ...checked, today].sort()[0] as string;
      return json({
        streak,
        heatmap,
        eligible_from: eligibleFrom,
        week: fakeHabitWeek(habit, habitCheckIns, eligibleFrom, today),
      });
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
      const pausedHabit = state.habits.find((h) => h.id === habitId);
      if (method === "PUT" && pausedHabit?.pauses.some((pause) => pauseCovers(pause, day))) {
        return json({ error: { code: "habit_day_paused", message: `Paused on ${day}` } }, 409);
      }
      if (method === "PUT" && pausedHabit?.skips.includes(day)) {
        return json({ error: { code: "habit_day_skipped", message: `Skipped on ${day}` } }, 409);
      }
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
        client_run_id?: string;
      };
      // Retry-safe (#546): the same run's id returns the session already
      // recorded for it, with 200, and records nothing.
      const runId = input.client_run_id;
      const recorded =
        runId === undefined
          ? undefined
          : state.focusSessions.find((s) => s.client_run_id === runId);
      if (recorded) {
        return json(withDuration(recorded), 200);
      }
      const created = fakeFocusSession({
        client_run_id: runId ?? null,
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
    if (url.pathname === "/api/v1/settings/now") {
      if (method === "GET") {
        return json({ enabled: state.nowEnabled });
      }
      if (method === "PUT") {
        state.nowEnabled = (body as { enabled: boolean }).enabled;
        return json({ enabled: state.nowEnabled });
      }
    }
    const occurrenceOf = (t: FakeTask): string => `${t.start_date}|${t.due_date}`;
    if (url.pathname === "/api/v1/now/shortlist") {
      if (method === "GET") {
        state.nowShortlist = state.nowShortlist.filter((entry) => {
          const task = state.tasks.find((t) => t.id === entry.taskId);
          entry.occurrence ??= task && occurrenceOf(task);
          return (
            task !== undefined &&
            !task.completed &&
            task.id !== state.nowTaskId &&
            occurrenceOf(task) === entry.occurrence
          );
        });
        return json({ task_ids: state.nowShortlist.map((e) => e.taskId) });
      }
      if (method === "PUT") {
        const wanted = [...new Set((body as { task_ids: number[] }).task_ids)].filter(
          (id) => id !== state.nowTaskId,
        );
        const tasks = wanted.map((id) => state.tasks.find((t) => t.id === id));
        if (tasks.some((t) => t === undefined)) {
          return json({ detail: "Task not found" }, 404);
        }
        state.nowShortlist = tasks.map((t) => ({ taskId: t!.id, occurrence: occurrenceOf(t!) }));
        return json({ task_ids: wanted });
      }
    }
    /** The backend's prune-on-read (#549); the note goes with the pick (#554). */
    const pruneNow = (): void => {
      const task = state.tasks.find((t) => t.id === state.nowTaskId);
      if (state.nowTaskId !== null) {
        state.nowOccurrence ??= task && occurrenceOf(task);
        if (!task || task.completed || occurrenceOf(task) !== state.nowOccurrence) {
          state.nowTaskId = null;
          state.nowOccurrence = undefined;
        }
      }
      if (state.nowTaskId === null) {
        state.nowNote = null;
      }
    };
    if (url.pathname === "/api/v1/now/note") {
      pruneNow();
      if (method === "GET") {
        return json({ note: state.nowNote });
      }
      if (method === "PUT") {
        const note = ((body as { note: string | null }).note ?? "").trim() || null;
        if (state.nowTaskId === null && note !== null) {
          return json(
            { error: { code: "no_now_selection", message: "Nothing is selected for Now" } },
            409,
          );
        }
        state.nowNote = note;
        return json({ note: state.nowNote });
      }
    }
    if (url.pathname === "/api/v1/now") {
      if (method === "GET") {
        pruneNow();
        return json({ task_id: state.nowTaskId });
      }
      if (method === "PUT") {
        const taskId = (body as { task_id: number | null }).task_id;
        const task = state.tasks.find((t) => t.id === taskId);
        if (taskId !== null && !task) {
          return json({ detail: "Task not found" }, 404);
        }
        const occurrence = task && occurrenceOf(task);
        if (taskId !== state.nowTaskId || occurrence !== state.nowOccurrence) {
          state.nowNote = null;
        }
        state.nowTaskId = taskId;
        state.nowOccurrence = occurrence;
        return json({ task_id: state.nowTaskId });
      }
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
    if (url.pathname === "/api/v1/settings/sections") {
      if (method === "GET") {
        return json({ ...state.sectionSettings });
      }
      if (method === "PUT") {
        state.sectionSettings = body as typeof state.sectionSettings;
        return json({ ...state.sectionSettings });
      }
    }
    if (url.pathname === "/api/v1/settings/gentle-return") {
      if (method === "PUT") {
        state.gentleReturn = (body as { enabled: boolean }).enabled;
      }
      return json({ enabled: state.gentleReturn });
    }
    if (url.pathname === "/api/v1/reminder-deliveries/claim" && method === "POST") {
      if (!state.reminderNotifications) return json({ items: [], held: [], quiet_until: null });
      const items = state.reminderClaims.filter((claim) => !handedOut.has(claim.id));
      for (const claim of items) handedOut.add(claim.id);
      return json({
        items: items.map((claim) => ({ ...claim })),
        held: state.heldReminders.map((held) => ({ ...held })),
        quiet_until: state.quietUntil,
      });
    }
    if (url.pathname === "/api/v1/reminder-deliveries/missed" && method === "GET") {
      if (!state.reminderNotifications) return json({ items: [] });
      return json({ items: state.missedReminders.map((entry) => ({ ...entry })) });
    }
    if (url.pathname === "/api/v1/reminder-deliveries/missed/dismiss" && method === "POST") {
      const key = body as FakeMissedDismissal;
      const same = (entry: FakeMissedReminder): boolean =>
        entry.task_id === key.task_id &&
        entry.offset === key.offset &&
        entry.occurrence_due === key.occurrence_due;
      const entry = state.missedReminders.find(same);
      if (entry === undefined) {
        return json({ error: { code: "not_found", message: "Missed reminder not found" } }, 404);
      }
      state.missedDismissals.push({ ...key });
      state.missedReminders = state.missedReminders.filter((candidate) => !same(candidate));
      return json({ id: 1, ...entry, state: "dismissed", attempt: 0 });
    }
    if (url.pathname === "/api/v1/reminder-deliveries/missed/snooze" && method === "POST") {
      const key = body as FakeMissedSnooze;
      const same = (entry: FakeMissedReminder): boolean =>
        entry.task_id === key.task_id &&
        entry.offset === key.offset &&
        entry.occurrence_due === key.occurrence_due;
      const entry = state.missedReminders.find(same);
      if (entry === undefined) {
        return json({ error: { code: "not_found", message: "Missed reminder not found" } }, 404);
      }
      state.missedSnoozes.push({ ...key });
      state.missedReminders = state.missedReminders.filter((candidate) => !same(candidate));
      const snoozedUntil = new Date(Date.now() + key.minutes * 60_000).toISOString();
      return json({ id: 1, ...entry, state: "snoozed", attempt: 0, snoozed_until: snoozedUntil });
    }
    const reminderReport = url.pathname.match(
      /^\/api\/v1\/reminder-deliveries\/(\d+)\/(shown|failed)$/,
    );
    if (reminderReport && method === "POST") {
      const id = Number(reminderReport[1]);
      const outcome = reminderReport[2] as "shown" | "failed";
      const claim = state.reminderClaims.find((candidate) => candidate.id === id);
      if (claim === undefined) {
        return json(
          { error: { code: "not_found", message: `Reminder delivery ${id} not found` } },
          404,
        );
      }
      const { lease_token } = body as { lease_token: string };
      state.reminderReports.push({ id, outcome, lease_token });
      if (claim.state === "claimed") claim.state = outcome;
      return json({ ...claim });
    }
    const reminderSnooze = url.pathname.match(/^\/api\/v1\/reminder-deliveries\/(\d+)\/snooze$/);
    if (reminderSnooze && method === "POST") {
      // Mirrors the server (issue #566): only the ledger row changes, and
      // an occurrence that is gone (Task completed, redated, Reminder
      // removed) is refused as stale.
      const id = Number(reminderSnooze[1]);
      const missedRow = state.missedReminders.find((entry) => entry.delivery_id === id);
      if (missedRow !== undefined) {
        // A missed Reminder with a ledger row (#566): snoozing it takes it
        // off the list until it comes due again.
        const { minutes } = body as { minutes: number };
        state.reminderSnoozes.push({ id, minutes });
        state.missedReminders = state.missedReminders.filter((entry) => entry !== missedRow);
        const snoozedUntil = new Date(Date.now() + minutes * 60_000).toISOString();
        return json({
          ...missedRow,
          id,
          state: "snoozed",
          attempt: 1,
          snoozed_until: snoozedUntil,
        });
      }
      const claim = state.reminderClaims.find((candidate) => candidate.id === id);
      if (claim === undefined) {
        return json(
          { error: { code: "not_found", message: `Reminder delivery ${id} not found` } },
          404,
        );
      }
      const task = state.tasks.find((candidate) => candidate.id === claim.task_id);
      if (
        task === undefined ||
        task.completed ||
        task.due_date !== claim.occurrence_due ||
        !task.reminders.includes(claim.offset)
      ) {
        return json(
          {
            error: {
              code: "reminder_stale",
              message: "This reminder's Task occurrence has changed since it was delivered",
            },
          },
          409,
        );
      }
      const { minutes } = body as { minutes: number };
      state.reminderSnoozes.push({ id, minutes });
      claim.state = "snoozed";
      claim.snoozed_until = new Date(Date.now() + minutes * 60_000).toISOString();
      return json({ ...claim });
    }
    if (url.pathname === "/api/v1/settings/quiet-hours") {
      if (method === "PUT") {
        const input = body as { enabled: boolean; start: string; end: string };
        const refusal =
          quietHoursError ??
          (input.start === input.end ? "Quiet hours must start and end at different times" : null);
        if (refusal !== null) {
          return json({ error: { code: "invalid_quiet_hours", message: refusal } }, 422);
        }
        state.quietHours = { ...input };
      }
      return json({ ...state.quietHours });
    }
    if (url.pathname === "/api/v1/settings/reminder-notifications") {
      if (method === "PUT") {
        state.reminderNotifications = (body as { enabled: boolean }).enabled;
      }
      return json({ enabled: state.reminderNotifications });
    }
    if (url.pathname === "/api/v1/settings/planning-window") {
      if (method === "GET") {
        return json({ ...state.planningWindow });
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
            { error: { code: "invalid_planning_window", message: "invalid planning window" } },
            422,
          );
        }
        state.planningWindow = { enabled: input.enabled, start: input.start, end: input.end };
        return json({ ...state.planningWindow });
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
    if (url.pathname === "/api/v1/settings/database") {
      if (method === "GET") {
        return json({ ...state.databaseStatus });
      }
    }
    if (url.pathname === "/api/v1/settings/database/test-connection") {
      if (method === "POST") {
        return json({ ...state.databaseTestConnectionResult });
      }
    }
    if (method === "GET" && url.pathname === "/api/v1/stand-up/suggestions/today") {
      const today = url.searchParams.get("date");
      if (today === null) {
        return json({ error: { code: "validation_error", message: "date is required" } }, 422);
      }
      const tz = url.searchParams.get("tz");
      if (tz !== null && !isKnownZone(tz)) {
        return json(
          { error: { code: "validation_error", message: `Unknown IANA timezone ${tz}` } },
          422,
        );
      }
      // Mirrors the backend: the Today Smart List's own query (open Tasks
      // whose scheduled window has started by `today`) plus Tasks completed
      // on `today` itself — bucketed in the caller's timezone, not UTC —
      // (deduped by task, open wins, orphan occurrences dropped like the
      // backend's inner join), reduced to a read-only chip shape.
      const zone = tz ?? "UTC";
      const open = state.tasks.filter(
        (task) => !task.completed && inSmartView(task, "today", today),
      );
      const items = open.map((task) => ({ task_id: task.id, title: task.title, completed: false }));
      const seen = new Set(open.map((task) => task.id));
      const addDone = (task_id: number, title: string): void => {
        if (seen.has(task_id)) {
          return;
        }
        seen.add(task_id);
        items.push({ task_id, title, completed: true });
      };
      for (const task of state.tasks) {
        if (
          task.completed &&
          task.completed_at !== null &&
          zonedDay(task.completed_at, zone) === today
        ) {
          addDone(task.id, task.title);
        }
      }
      const titles = new Map(state.tasks.map((task) => [task.id, task.title]));
      for (const occurrence of state.completedOccurrences) {
        if (zonedDay(occurrence.completed_at, zone) !== today) {
          continue;
        }
        const title = titles.get(occurrence.task_id);
        if (title === undefined) {
          continue;
        }
        addDone(occurrence.task_id, title);
      }
      return json(items);
    }
    if (method === "GET" && url.pathname === "/api/v1/stand-up/focused-goal") {
      const focused = state.goals.find((g) => g.is_focused);
      return json(focused ? serializeGoal(focused, state) : null);
    }
    if (method === "GET" && url.pathname === "/api/v1/stand-up/suggestions/yesterday") {
      const tz = url.searchParams.get("tz");
      if (tz !== null && !isKnownZone(tz)) {
        return json(
          { error: { code: "validation_error", message: `Unknown IANA timezone ${tz}` } },
          422,
        );
      }
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
        // Sprint Goal is superseded by the focused Goal (ADR 0012, issue
        // #238) — new Entries no longer snapshot it.
        entry = fakeStandupEntry(day, { sprint_goal_snapshot: "" });
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
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await handle(input, init);
    const method = (init?.method ?? "GET").toUpperCase();
    const pathname = new URL(String(input), "http://localhost").pathname;
    if (method !== "GET" && state.loseWriteResponse?.(method, pathname) === true) {
      // The write landed, but its response never reaches the client.
      throw new TypeError("Failed to fetch");
    }
    return response;
  });

  vi.stubGlobal("fetch", fetchMock);
  return state;
}
