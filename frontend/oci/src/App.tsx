import "./App.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchCompletedOccurrences,
  fetchCompletedTasks,
  fetchFolders,
  fetchLists,
  fetchOpenTasks,
  fetchSearchTasks,
  fetchSections,
  fetchSmartTasks,
  fetchStandupSettings,
  fetchSectionSettings,
  type SectionSettings,
  fetchTags,
  fetchTasks,
  fetchTasksByTag,
  deleteTask,
  updateList,
  updateTask,
  SMART_LABELS,
  type AllFilters,
  type CompletedOccurrence,
  type Event,
  type Folder,
  type Section,
  type SmartView,
  type Tag,
  type Task,
  type TaskList,
  type TaskPatch,
  type CurrentUser,
  fetchCurrentUser,
} from "./api";
import { type CalendarMode } from "./calendar";
import {
  clearedSchedule,
  durationMinutes,
  formatDate,
  localDayOf,
  rescheduledToDay,
} from "./dates";
import { FocusRunProvider, useStartPomo } from "./focusRunContext";
import { groupTodayTasks, type GroupBy, type SortBy } from "./grouping";
import {
  applyThemePreference,
  loadHideCompleted,
  loadSidebarCollapsed,
  loadThemePreference,
  resolveThemePreference,
  saveHideCompleted,
  saveSidebarCollapsed,
  saveThemePreference,
  type ThemePreference,
} from "./layoutPrefs";
import {
  calendarModeForPath,
  containerForPath,
  pathForContainer,
  pathForCalendarMode,
  pathForSettingsTab,
  pathForSmartView,
  pathForStaticView,
  settingsTabForPath,
  smartViewForPath,
  staticViewKindForPath,
  type SettingsTab,
  type StaticViewKind,
} from "./routes";
import { deriveOpenTaskCounts } from "./openCounts";
import { type PaletteItem } from "./commandPalette";
import { useRegisterShortcut } from "./shortcuts";
import { looksLikeDatePhrase } from "./quickAdd";
import { useUndoQueue } from "./undoQueue";
import { useAssistantAvailable } from "./useAssistantAvailable";
import { useVoiceAvailable } from "./useVoiceAvailable";
import { livekitProvider } from "./voice/livekit";
import { SMART_GROUP_OPTIONS, ViewMenu } from "./components/AllViewControls";
import { CalendarView } from "./components/CalendarView";
import { CommandPalette, type TaskActionHandlers } from "./components/CommandPalette";
import { CompletedView } from "./components/CompletedView";
import { EventDetail } from "./components/EventDetail";
import { FocusStatsView } from "./components/FocusStatsPanel";
import { FocusView } from "./components/FocusView";
import { FolderView, type FolderSortBy } from "./components/FolderView";
import { GoalsView } from "./components/GoalsView";
import { HabitsView } from "./components/HabitsView";
import { AssistantPage } from "./components/AssistantPage";
import { VoiceProvider } from "./voice/VoiceProvider";
import { VoiceOverlay } from "./components/VoiceOverlay";
import { KanbanView } from "./components/KanbanView";
import { MobileTabBar } from "./components/MobileTabBar";
import { MoreSheet } from "./components/MoreSheet";
import { Modal } from "./components/Modal";
import { QuickAdd } from "./components/QuickAdd";
import { QuickAddDialog } from "./components/QuickAddDialog";
import { SearchView, type SearchState } from "./components/SearchView";
import { SettingsView } from "./components/SettingsView";
import { ShortcutHints, ShortcutsProvider } from "./components/ShortcutLayer";
import { Sidebar } from "./components/Sidebar";
import { UserMenu } from "./components/UserMenu";
import { DayRail } from "./components/DayRail";
import { FocusCard } from "./components/FocusCard";
import { HabitsCard } from "./components/HabitsCard";
import { HabitStrip } from "./components/HabitStrip";
import { useTodayHabits } from "./todayHabits";
import { FocusedGoalCard } from "./components/FocusedGoalCard";
import { StandupView } from "./components/StandupView";
import { TaskDetail } from "./components/TaskDetail";
import { TaskListView } from "./components/TaskListView";
import { EmptyState, LoadError, SkeletonRows } from "./components/TaskViewState";
import { ToastStack } from "./components/ToastStack";

/** What the main pane shows: one List, one Tag, one Folder (its Tasks across
 * every List it contains — #126), one computed Smart List, the Calendar /
 * Habits / Focus screens (which fetch their own data), or Search results. A
 * focus view may carry the Task to start a Pomo against. */
type View =
  | { kind: "list"; id: number; mode?: "list" | "kanban" | "completed" }
  | { kind: "tag"; id: number }
  | { kind: "folder"; id: number }
  | { kind: "smart"; view: SmartView }
  | { kind: "calendar"; mode: CalendarMode }
  | { kind: "goals" }
  | { kind: "habits" }
  | { kind: "standup" }
  | { kind: "assistant" }
  | { kind: "focus"; task?: Task }
  | { kind: "focus-stats" }
  | { kind: "search"; search: SearchState }
  | { kind: "settings"; tab: SettingsTab }
  | null;

/** A stable identity for a View, for use as an effect dependency: two Views
 * with the same key show the same screen. Kept next to `View` so the encoding
 * moves with the type it encodes. */
/** Where a Task view's load stands (#441). */
type TaskLoadStatus = "loading" | "ready" | "error";

/** What a Task view load asked for — a load only describes the view while
 * this still matches. */
function taskLoadKeyOf(view: View, completedMode: boolean, allFilters: AllFilters): string {
  return JSON.stringify([view, completedMode, view?.kind === "smart" ? allFilters : null]);
}

function keyOfView(view: View): string {
  if (view === null) {
    return "";
  }
  return `${view.kind}:${"id" in view ? view.id : ""}`;
}

/** A fresh Search, with no query or filters — what /search always opens to,
 * whether loaded directly or reached via the Search nav item (issue #143). */
const BLANK_SEARCH_STATE: SearchState = {
  query: "",
  listId: null,
  tagId: null,
  priority: null,
  completed: null,
};

/** No narrowing — Today/Next 7 Days always fetch with this, since only "All"
 * offers filter controls. */
/** A List's group choices: it has real Sections, so "section" is offered by name. */
const LIST_GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "section", label: "Section" },
  { value: "date", label: "Date" },
  { value: "priority", label: "Priority" },
];

const BLANK_ALL_FILTERS: AllFilters = { listId: null, tagId: null, priority: null };

/** Which of the URL-addressable static views (if any) a View shows —
 * List/Tag/Folder views have no path, so this is null for them. */
function staticViewKindOf(view: View): StaticViewKind | null {
  if (
    view?.kind === "calendar" ||
    view?.kind === "goals" ||
    view?.kind === "habits" ||
    view?.kind === "standup" ||
    view?.kind === "assistant" ||
    view?.kind === "focus" ||
    view?.kind === "focus-stats" ||
    view?.kind === "search" ||
    view?.kind === "settings" ||
    view?.kind === "smart"
  ) {
    return view.kind;
  }
  return null;
}

/** The View a static path resolves to on a fresh load: always blank/no
 * pre-selection, since neither a query nor a task can be encoded in these
 * URLs (issue #143). The Calendar's mode and the Smart List shown are the
 * exceptions — both read straight off the path (`/calendar/week`, `/today`,
 * etc.), defaulting to Day and Today respectively. */
function viewForStaticKind(kind: StaticViewKind, pathname: string): View {
  switch (kind) {
    case "search":
      return { kind: "search", search: BLANK_SEARCH_STATE };
    case "calendar":
      return { kind: "calendar", mode: calendarModeForPath(pathname) ?? "day" };
    case "smart":
      return { kind: "smart", view: smartViewForPath(pathname) ?? "today" };
    case "goals":
      return { kind: "goals" };
    case "habits":
      return { kind: "habits" };
    case "standup":
      return { kind: "standup" };
    case "assistant":
      return { kind: "assistant" };
    case "focus":
      return { kind: "focus" };
    case "focus-stats":
      return { kind: "focus-stats" };
    case "settings":
      return { kind: "settings", tab: settingsTabForPath(pathname) ?? "account" };
  }
}

interface AppProps {
  voiceProvider?: import("./voice/session").VoiceProvider;
  /** Absent in tests that render App on its own — AuthGate is the only
   * caller that supplies it, so App's bootstrap and tests never need to
   * know authentication exists beyond forwarding this one callback. */
  onLogout?: () => void;
  /** The signed-in account, from the gate's probe. App reads it itself
   * when rendered on its own (as its tests do). */
  user?: CurrentUser;
}

/** Who is signed in: the gate's answer when given, else read once; kept
 * current by whatever re-reads or changes the record later (Settings). */
function useCurrentUser(
  given: CurrentUser | undefined,
): [CurrentUser | null, (user: CurrentUser) => void] {
  const [user, setUser] = useState<CurrentUser | null>(given ?? null);
  useEffect(() => {
    if (given !== undefined) return;
    let live = true;
    fetchCurrentUser().then(
      (fetched) => {
        if (live) setUser(fetched);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [given]);
  return [user, setUser];
}

/** True at/below the phone breakpoint (720px, same as the stylesheet), live. */
function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth <= 720);
  useEffect(() => {
    if (typeof window.matchMedia === "function") {
      const query = window.matchMedia("(max-width: 720px)");
      setNarrow(query.matches);
      const onChange = (event: MediaQueryListEvent): void => setNarrow(event.matches);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    }
    const onResize = (): void => setNarrow(window.innerWidth <= 720);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return narrow;
}

export function App({
  onLogout,
  user: signedInUser,
  voiceProvider = livekitProvider,
}: AppProps = {}): React.JSX.Element {
  const [currentUser, setCurrentUser] = useCurrentUser(signedInUser);
  const [lists, setLists] = useState<TaskList[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  // Resolved from the URL on the very first render (rather than in a mount
  // effect) so a direct load of a static path never runs a render with the
  // "wrong" view — an effect-driven setView here would land in the same
  // commit as the URL-sync effect below, which would then read the stale
  // pre-update view and incorrectly clobber lastSyncedKindRef (issue #143).
  const [view, setView] = useState<View>(() => {
    const kind = staticViewKindForPath(window.location.pathname);
    return (
      containerForPath(window.location.pathname) ??
      (kind !== null ? viewForStaticKind(kind, window.location.pathname) : null)
    );
  });
  // The completed view of the current List (or of All): computed, newest first.
  const [completedMode, setCompletedMode] = useState(() => {
    const route = containerForPath(window.location.pathname);
    return route?.kind === "list" && route.mode === "completed";
  });
  const [containersLoaded, setContainersLoaded] = useState(false);
  const [missingViewNotice, setMissingViewNotice] = useState(false);
  // Hides completed Tasks from List/Tag/Folder views instead of showing them
  // struck-through inline — a display preference (see layoutPrefs), not a
  // fetch filter: the completed Tasks stay loaded, just off-screen, so
  // toggling it back needs no refetch.
  const [hideCompleted, setHideCompleted] = useState(loadHideCompleted);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  // The Calendar view keeps its own task list (App's `tasks` isn't populated
  // for it), so a task selected there is stashed here to resolve selectedTask.
  const [calendarTask, setCalendarTask] = useState<Task | null>(null);
  // The read-only Event detail popover (issue #110): its own state, never
  // mixed with selectedTaskId — clicking an Event must never open the
  // (editable) Task detail panel.
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  // Bumped after "Convert to task" (issue #111) so the Calendar force-reloads:
  // the converted Event disappears and the new Task appears immediately.
  const [calendarRefresh, setCalendarRefresh] = useState(0);
  const [tasks, setTasks] = useState<Task[]>([]);
  // Whether the current Task view's Tasks have loaded (#441), keyed by what
  // was asked for, so a view that hasn't loaded yet is never shown as empty
  // and a background refresh of the same view doesn't flash placeholders.
  const [taskLoad, setTaskLoad] = useState<{ key: string; status: TaskLoadStatus }>({
    key: "",
    status: "loading",
  });
  const taskLoadKeyRef = useRef("");
  const taskLoadSeqRef = useRef(0);
  const tasksRef = useRef<Task[]>([]);
  tasksRef.current = tasks;
  // Every open Task across every List, held once and kept current as Tasks
  // change — the client-side source for the sidebar's open-Task counts
  // (issue #195), never refetched on a mutation.
  const [openTasks, setOpenTasks] = useState<Task[]>([]);
  // Completed Occurrences of recurring tasks, shown only in the completed view.
  const [occurrences, setOccurrences] = useState<CompletedOccurrence[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  // The last Task-saved confirmation (#544), written into a live region that
  // is always mounted. `count` remounts the text so saving twice to the same
  // List is announced twice.
  const [savedAnnouncement, setSavedAnnouncement] = useState<{
    text: string;
    count: number;
  } | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // The command palette opened scoped to one Task (issue #205) — its verb
  // menu. Independent of `paletteOpen` (the jump surface); at most one is
  // ever on screen. Scope guard: exactly one Task, never a selection.
  const [paletteTask, setPaletteTask] = useState<Task | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadSidebarCollapsed);
  // Appearance (issue #193) — a browser-local preference, like the collapsed
  // state above. The resolved `data-theme` is (re)applied on every change,
  // and "system" keeps a live subscription to the OS setting.
  const [themePreference, setThemePreference] = useState<ThemePreference>(loadThemePreference);
  // Mobile only (#462): the More sheet that replaced the navigation drawer.
  // Ignored by the desktop layout, where the tab bar is hidden.
  const [moreOpen, setMoreOpen] = useState(false);
  // `<main>` is the app's real scroll region (`.app` itself is
  // `overflow: hidden`), so the sheet locks `main`'s own overflow to stop a
  // drag over its scrim from moving the list underneath (#290); `overflow:
  // hidden` alone preserves `scrollTop`.
  const mainRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const main = mainRef.current;
    if (main === null) return;
    main.style.overflow = moreOpen ? "hidden" : "";
  }, [moreOpen]);
  const closeMore = useCallback(() => setMoreOpen(false), []);
  // Whether the Stand-up nav item/route is shown (issue #140) — fetched once
  // at load, defaulting to true so the nav item doesn't flash away on a slow
  // network before the real value arrives.
  const [standupEnabled, setStandupEnabled] = useState(true);
  // Whether the Calendar/Goals/Habits/Focus/Assistant nav items/routes are
  // shown (this feature) — same fetched-once-at-load pattern as
  // standupEnabled above, defaulting to all-true so nothing flashes away.
  const [sectionSettings, setSectionSettings] = useState<SectionSettings>({
    calendar: true,
    goals: true,
    habits: true,
    focus: true,
    assistant: true,
  });
  // Whether the Assistant nav item/route is shown (ADR 0009, issue #185):
  // polled on load and window refocus, mirroring Quick-Add's Assist gate.
  // No settings toggle — unlike Stand-up, this is never independently
  // configurable, only a direct read of whether a provider is configured.
  // `null` while the probe is still in flight: an affordance needs a
  // settled `true`, but the route guard below must not act on anything but
  // a settled `false`, or a hard load of /assistant redirects itself away
  // before the answer arrives.
  const assistantStatus = useAssistantAvailable();
  const textAssistantAvailable = assistantStatus === true && sectionSettings.assistant;
  // Voice Assistant (ADR 0015, issue #366): invisible until LiveKit is
  // configured in Settings.
  const voiceStatus = useVoiceAvailable(voiceProvider);
  const voiceAvailable = voiceStatus === true;
  // /assistant holds both the text and the voice assistant: it is there when either is.
  const assistantAvailable = textAssistantAvailable || voiceAvailable;
  // Voice writes (issue #369) land through the API, not through a view's own handlers, so every
  // surface that can show a Task or Habit re-reads. A ref keeps the callback the open session
  // holds pointed at the current view's loader.
  const [habitsRefresh, setHabitsRefresh] = useState(0);
  const voiceRefreshRef = useRef<() => void>(() => undefined);
  const refreshAfterVoiceWrite = useCallback((): void => {
    voiceRefreshRef.current();
  }, []);
  const [groupBy, setGroupBy] = useState<GroupBy>("section");
  const [sortBy, setSortBy] = useState<SortBy>("custom");
  // The Folder view's own sort preference (#126) — kept separate from the
  // List view's `sortBy` above so visiting one never disturbs the other,
  // and restricted to date/priority/title: there's no manual cross-List
  // order to preserve, so "custom" isn't offered here.
  const [folderSortBy, setFolderSortBy] = useState<FolderSortBy>("date");
  // The Smart Lists' List/Tag/Priority narrowing — one set shared by Today,
  // Next 7 Days and All, like `groupBy`/`sortBy` above, and kept separate
  // from Search's filters so the two never disturb each other.
  const [allFilters, setAllFilters] = useState<AllFilters>(BLANK_ALL_FILTERS);

  // Lands here after the Google OAuth round trip (app.routers.v1.google
  // redirects to this origin with one of these markers): open Settings
  // straight away so the result is visible without an extra click, and
  // strip the marker so it doesn't linger in the address bar.
  const [googleOAuthError, setGoogleOAuthError] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("googleConnected") || params.has("googleError")) {
      setView({ kind: "settings", tab: "account" });
      setGoogleOAuthError(params.has("googleError"));
      params.delete("googleConnected");
      params.delete("googleError");
      const query = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : ""));
    }
  }, []);

  // URL routing for the six static views (issue #143). `lastSyncedKindRef`
  // starts out already matching whatever the URL says (the initial `view`
  // state above resolves the same way), so the very first sync-to-URL
  // effect run (below) is already a no-op match. `suppressNextSyncRef`
  // marks a view change driven by Back/Forward rather than by the user
  // navigating within the app — that must never itself push or replace
  // history, since the browser already positioned it there.
  const lastSyncedKindRef = useRef<string | null>(
    containerForPath(window.location.pathname)
      ? window.location.pathname
      : staticViewKindForPath(window.location.pathname),
  );
  const suppressNextSyncRef = useRef(false);

  // An unrecognized path redirects to "/" (falling into the Inbox-fallback
  // effect below) — recognized paths are already handled by `view`'s
  // initial state above.
  useEffect(() => {
    if (
      staticViewKindForPath(window.location.pathname) === null &&
      containerForPath(window.location.pathname) === null &&
      window.location.pathname !== "/"
    ) {
      window.history.replaceState(null, "", "/");
    }
  }, []);

  // Back/Forward between visited static views (and back to "/" for
  // everything else, which the Inbox-fallback effect resolves from there).
  useEffect(() => {
    function onPopState(): void {
      if (ignoreNextPopRef.current) {
        ignoreNextPopRef.current = false;
        return;
      }
      if (sheetEntryRef.current) {
        sheetEntryRef.current = false;
        setSelectedTaskId(null);
        setCalendarTask(null);
        return;
      }
      const kind = staticViewKindForPath(window.location.pathname);
      suppressNextSyncRef.current = true;
      const route = containerForPath(window.location.pathname);
      setCompletedMode(route?.kind === "list" && route.mode === "completed");
      setMoreOpen(false);
      setView(route ?? (kind !== null ? viewForStaticKind(kind, window.location.pathname) : null));
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Container destinations and List modes each get a history entry.
  // Search edits stay within their view; Back/Forward never pushes.
  useEffect(() => {
    const containerPath =
      view && (view.kind === "list" || view.kind === "tag" || view.kind === "folder")
        ? pathForContainer(view)
        : null;
    const kind = containerPath ?? staticViewKindOf(view);
    if (suppressNextSyncRef.current) {
      suppressNextSyncRef.current = false;
      lastSyncedKindRef.current = kind;
      return;
    }
    if (kind === lastSyncedKindRef.current) {
      return;
    }
    lastSyncedKindRef.current = kind;
    if (containerPath !== null) {
      window.history.pushState(null, "", containerPath);
    } else if (kind === "calendar" && view?.kind === "calendar") {
      window.history.pushState(null, "", pathForCalendarMode(view.mode));
    } else if (kind === "settings" && view?.kind === "settings") {
      window.history.pushState(null, "", pathForSettingsTab(view.tab));
    } else if (kind === "smart" && view?.kind === "smart") {
      window.history[missingViewNotice ? "replaceState" : "pushState"](
        null,
        "",
        pathForSmartView(view.view),
      );
    } else if (kind !== null) {
      window.history.pushState(null, "", pathForStaticView(kind as StaticViewKind));
    } else if (window.location.pathname !== "/") {
      window.history.replaceState(null, "", "/");
    }
  }, [view, missingViewNotice]);

  // Keeps /calendar/<mode> in sync with the mode picker: a `replaceState`
  // (never a push) since switching Month/Week/Day is a within-view toggle,
  // not a new place to Back/Forward through — same treatment Search's filter
  // edits get above. A no-op when the path already matches (a direct load,
  // or Back/Forward already landing on the right mode via the effect above).
  useEffect(() => {
    if (view?.kind !== "calendar") {
      return;
    }
    const path = pathForCalendarMode(view.mode);
    if (window.location.pathname !== path) {
      window.history.replaceState(null, "", path);
    }
  }, [view]);

  // Settings' tabs (#474) are separate places, so switching tabs pushes a
  // history entry. A redirect replaces instead: the bare /settings alias, or
  // the Users URL for someone who is not an Admin (SettingsView decides that).
  const replaceSettingsTabRef = useRef(false);
  const showSettingsTab = useCallback(
    (tab: SettingsTab, options: { replace?: boolean } = {}): void => {
      replaceSettingsTabRef.current = options.replace ?? false;
      setView({ kind: "settings", tab });
    },
    [],
  );
  useEffect(() => {
    if (view?.kind !== "settings") {
      return;
    }
    const replace = replaceSettingsTabRef.current || window.location.pathname === "/settings";
    replaceSettingsTabRef.current = false;
    const path = pathForSettingsTab(view.tab);
    if (window.location.pathname !== path) {
      window.history[replace ? "replaceState" : "pushState"](null, "", path);
    }
  }, [view]);

  // Keeps /today, /next-7-days, and /all in sync with which Smart List is
  // selected, the same `replaceState` treatment the Calendar's mode picker
  // gets above — switching between them is a within-category pick, not a
  // new place to Back/Forward through.
  useEffect(() => {
    if (view?.kind !== "smart") {
      return;
    }
    const path = pathForSmartView(view.view);
    if (window.location.pathname !== path) {
      window.history.replaceState(null, "", path);
    }
  }, [view]);

  useEffect(() => {
    void Promise.all([fetchLists(), fetchFolders(), fetchTags(), fetchOpenTasks()]).then(
      ([listPage, folderPage, tagPage, openTaskPage]) => {
        setLists(listPage.items);
        setFolders(folderPage.items);
        setTags(tagPage.items);
        setOpenTasks(openTaskPage.items);
        setContainersLoaded(true);
      },
    );
  }, []);

  useEffect(() => {
    void fetchStandupSettings().then((settings) => setStandupEnabled(settings.enabled));
  }, []);

  useEffect(() => {
    void fetchSectionSettings().then(setSectionSettings);
  }, []);

  // The command palette (issue #201): cmd/ctrl+K from anywhere, including a
  // focused text field or an open dialog — this is a raw listener rather than
  // a registration against the shortcut layer precisely so the typing-context
  // suppression there doesn't apply. With a Task selected it opens scoped to
  // that Task's verbs (issue #205) instead of the jump surface; the ref keeps
  // the listener from needing a re-subscribe on every selection change.
  const selectedTaskRef = useRef<Task | null>(null);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        const scopedTask = selectedTaskRef.current;
        if (scopedTask !== null) {
          setPaletteTask(scopedTask);
        } else {
          setPaletteOpen(true);
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Wait for container data before treating a deep link as stale.
  useEffect(() => {
    if (view?.kind === "standup" && !standupEnabled) {
      // The feature was turned off (or already was, on load) while this
      // route was showing — fall through to the same Inbox fallback as a
      // deleted List/Tag/Folder, rather than leaving an inaccessible route
      // selected in the sidebar.
    } else if (view?.kind === "calendar" && !sectionSettings.calendar) {
      // Same fallback as Stand-up above, for each of the other
      // independently-toggleable sections (this feature).
    } else if (view?.kind === "goals" && !sectionSettings.goals) {
      // no-op — falls through to the shared reset below
    } else if (view?.kind === "habits" && !sectionSettings.habits) {
      // no-op — falls through to the shared reset below
    } else if ((view?.kind === "focus" || view?.kind === "focus-stats") && !sectionSettings.focus) {
      // no-op — falls through to the shared reset below
    } else if (
      view?.kind === "assistant" &&
      (!sectionSettings.assistant || assistantStatus === false) &&
      voiceStatus === false
    ) {
      // Same fallback, for the Assistant becoming (or already being)
      // unavailable while this route was showing — but only once neither the
      // text nor the voice assistant can serve it (voice `null` is "still
      // checking", which must not bounce a hard load).
    } else if (
      view?.kind === "smart" ||
      view?.kind === "calendar" ||
      view?.kind === "goals" ||
      view?.kind === "habits" ||
      view?.kind === "standup" ||
      view?.kind === "assistant" ||
      view?.kind === "focus" ||
      view?.kind === "focus-stats" ||
      view?.kind === "search" ||
      view?.kind === "settings"
    ) {
      return;
    }
    if (view?.kind === "list" && lists.some((list) => list.id === view.id)) {
      return;
    }
    if (view?.kind === "tag" && tags.some((tag) => tag.id === view.id)) {
      return;
    }
    if (view?.kind === "folder" && folders.some((folder) => folder.id === view.id)) {
      return;
    }
    if (view && (view.kind === "list" || view.kind === "tag" || view.kind === "folder")) {
      if (!containersLoaded) return;
      setMissingViewNotice(true);
    }
    const next: View = { kind: "smart", view: "today" };
    setCompletedMode(false);
    // Guard against a stale closure: a view switch may land between this
    // effect's render and it running (e.g. the user clicks Calendar just as
    // the lists load). Never stomp a view that changed in the meantime.
    setView((current) => (current === view ? next : current));
  }, [
    lists,
    tags,
    folders,
    view,
    standupEnabled,
    sectionSettings,
    assistantStatus,
    voiceStatus,
    containersLoaded,
  ]);

  /** Fetch what the current view shows. Smart Lists and the completed view are
   * computed queries, so edits re-run this rather than patching local state. */
  const loadTasks = useCallback(async (): Promise<void> => {
    if (
      view === null ||
      view.kind === "calendar" ||
      view.kind === "goals" ||
      view.kind === "habits" ||
      view.kind === "standup" ||
      view.kind === "assistant" ||
      view.kind === "focus" ||
      view.kind === "focus-stats" ||
      view.kind === "settings"
    ) {
      return;
    }
    const key = taskLoadKeyOf(view, completedMode, allFilters);
    const seq = ++taskLoadSeqRef.current;
    if (taskLoadKeyRef.current !== key) {
      taskLoadKeyRef.current = key;
      setTaskLoad({ key, status: "loading" });
    }
    // Responses for a view the user has since left are dropped.
    const current = (): boolean => seq === taskLoadSeqRef.current;
    const setTasksIfCurrent = (next: Task[]): void => {
      if (current()) setTasks(next);
    };
    try {
      if (completedMode) {
        const scope = view.kind === "list" ? view.id : null;
        const [completedPage, occurrencePage] = await Promise.all([
          fetchCompletedTasks(scope),
          fetchCompletedOccurrences(scope),
        ]);
        setTasksIfCurrent(completedPage.items);
        if (current()) setOccurrences(occurrencePage.items);
      } else if (view.kind === "smart") {
        setTasksIfCurrent(
          (await fetchSmartTasks(view.view, localDayOf(new Date()), allFilters)).items,
        );
      } else if (view.kind === "search") {
        // An empty query shows nothing — without even asking the API.
        setTasksIfCurrent(
          view.search.query.trim() === ""
            ? []
            : (await fetchSearchTasks(view.search.query, view.search)).items,
        );
      } else if (view.kind === "list") {
        setTasksIfCurrent((await fetchTasks(view.id)).items);
      } else if (view.kind === "folder") {
        // No endpoint spans multiple Lists — fetch each member List's Tasks
        // and flatten. Archived Lists stay out of the Folder view, same as
        // they stay out of the sidebar's Folder contents.
        const members = lists.filter((list) => list.folder_id === view.id && !list.is_archived);
        const pages = await Promise.all(members.map((list) => fetchTasks(list.id)));
        setTasksIfCurrent(pages.flatMap((page) => page.items));
      } else {
        setTasksIfCurrent((await fetchTasksByTag(view.id)).items);
      }
      if (current()) setTaskLoad({ key, status: "ready" });
    } catch {
      if (current()) setTaskLoad({ key, status: "error" });
    }
  }, [view, completedMode, lists, allFilters]);

  voiceRefreshRef.current = () => {
    void loadTasks();
    void fetchOpenTasks().then((page) => setOpenTasks(page.items));
    setCalendarRefresh((current) => current + 1);
    setHabitsRefresh((current) => current + 1);
  };

  useEffect(() => {
    if (view === null) {
      return;
    }
    void loadTasks();
    if (view.kind === "list") {
      void fetchSections(view.id).then((page) => setSections(page.items));
    } else {
      setSections([]);
    }
  }, [view, loadTasks]);

  const selectedList =
    view?.kind === "list"
      ? (() => {
          const list = lists.find((list) => list.id === view.id);
          return list
            ? {
                ...list,
                view_mode: view.mode === "kanban" ? ("kanban" as const) : ("list" as const),
              }
            : null;
        })()
      : null;
  const selectedTag =
    view?.kind === "tag" ? (tags.find((tag) => tag.id === view.id) ?? null) : null;
  const selectedFolder =
    view?.kind === "folder" ? (folders.find((folder) => folder.id === view.id) ?? null) : null;
  // The Folder currently viewed, or the one the currently viewed List sits
  // in (for the header breadcrumb) — either way, its member Lists.
  const parentFolder =
    selectedList !== null && selectedList.folder_id !== null
      ? (folders.find((folder) => folder.id === selectedList.folder_id) ?? null)
      : null;
  const folderMembers =
    selectedFolder !== null
      ? lists.filter((list) => list.folder_id === selectedFolder.id && !list.is_archived)
      : [];
  const smartView = view?.kind === "smart" ? view.view : null;
  const selectedTask =
    tasks.find((task) => task.id === selectedTaskId) ??
    (calendarTask?.id === selectedTaskId ? calendarTask : null);
  // Read by the cmd/ctrl+K listener, which is subscribed once (see above).
  selectedTaskRef.current = selectedTask;
  // Computed views can't be patched locally: membership depends on the query.
  const isComputedView = smartView !== null || completedMode || view?.kind === "search";
  // "Hide completed" (this feature) only touches List/Tag/Folder views —
  // Search keeps its own Status filter, and the Completed view IS the
  // completed tasks, so filtering either of those out would be self-defeating.
  const visibleTasks = hideCompleted ? tasks.filter((task) => !task.completed) : tasks;
  // The toggle only earns its place where completed Tasks can actually show
  // inline: List/Tag/Folder views. Smart Lists are open-only already
  // (server-side), the Completed view is nothing but completed Tasks, and
  // Search has its own Status filter — hiding would be a no-op or self-
  // defeating in each of those.
  const showHideCompletedToggle =
    !completedMode && (selectedList !== null || selectedTag !== null || selectedFolder !== null);
  // The completed view exists per List and for All (not Today / Next 7 Days).
  // The Task view's load state (#441). Not-yet-loaded reads as loading, so an
  // unloaded view is never mistaken for an empty one.
  const taskViewStatus: TaskLoadStatus =
    taskLoad.key === taskLoadKeyOf(view, completedMode, allFilters) ? taskLoad.status : "loading";
  const taskViewName =
    selectedList !== null
      ? selectedList.name
      : selectedFolder !== null
        ? selectedFolder.name
        : selectedTag !== null
          ? `#${selectedTag.name}`
          : smartView !== null
            ? SMART_LABELS[smartView]
            : "tasks";
  // A loaded view with nothing to show gets a real empty state. Kanban keeps
  // its columns (they're where Tasks get added), a List with Sections keeps
  // them, and the Completed view says its own nothing.
  const emptyTaskView: { title: string; description: string } | null =
    completedMode || visibleTasks.length > 0 || view?.kind === "search"
      ? null
      : selectedList !== null
        ? selectedList.view_mode === "kanban" || sections.length > 0
          ? null
          : {
              title: `${selectedList.name} is empty`,
              description: `Tasks you add to ${selectedList.name} show up here.`,
            }
        : selectedTag !== null
          ? {
              title: `No tasks tagged ${selectedTag.name}`,
              description: `Tag a Task with #${selectedTag.name} to collect it here.`,
            }
          : selectedFolder !== null
            ? folderMembers.length === 0
              ? null
              : {
                  title: `Nothing in ${selectedFolder.name}`,
                  description: `Tasks in this folder’s lists show up here.`,
                }
            : smartView === "today"
              ? {
                  title: "Nothing due today",
                  description: "Tasks due today, and anything overdue, show up here.",
                }
              : smartView === "next7"
                ? {
                    title: "Nothing in the next 7 days",
                    description: "Tasks due this week show up here, day by day.",
                  }
                : smartView === "all"
                  ? {
                      title: "No open tasks",
                      description: "Every open Task across your lists shows up here.",
                    }
                  : null;
  const hasCompletedView = selectedList !== null || smartView === "all";

  // One queue for the whole app: undo toasts for delete/complete (#155) and
  // create confirmations (#191) share it, so two stacks can never overlap and
  // a pending undo isn't lost when its view unmounts.
  const toasts = useUndoQueue();
  const clearToasts = toasts.clearAll;
  const notify = toasts.notify;

  // No toast outlives the screen it was raised on: a stale "Added to Errands"
  // on a screen the user has already left is noise, and its "Show Task" would
  // undo their navigation. Anything still pending commits on the way out.
  const viewKey = keyOfView(view);
  // The Day rail (#446) sits beside Today only, and only when a card is on.
  const showDayRail =
    smartView === "today" &&
    !completedMode &&
    (sectionSettings.goals || sectionSettings.habits || sectionSettings.focus);
  useEffect(() => {
    clearToasts();
  }, [viewKey, clearToasts]);
  // One Check-in path for the rail's Habits card and the phone chip strip (#447, #461).
  const todayHabits = useTodayHabits();
  const showHabitStrip = smartView === "today" && !completedMode && sectionSettings.habits;

  useEffect(() => {
    if (missingViewNotice && view?.kind === "smart" && view.view === "today") {
      notify("That List, Tag or Folder no longer exists.");
      setMissingViewNotice(false);
    }
  }, [missingViewNotice, view, notify]);

  useEffect(() => {
    applyThemePreference(themePreference);
  }, [themePreference]);

  function chooseTheme(preference: ThemePreference): void {
    saveThemePreference(preference);
    setThemePreference(preference);
  }

  // The nav-bar shortcut (this feature): flip to the opposite of whatever is
  // on screen right now. Lands on a concrete "light"/"dark" — picking "system"
  // back up is left to the Settings radio group.
  function toggleTheme(): void {
    chooseTheme(resolveThemePreference(themePreference) === "dark" ? "light" : "dark");
  }

  function toggleSidebar(): void {
    setSidebarCollapsed((current) => {
      saveSidebarCollapsed(!current);
      return !current;
    });
  }

  function switchView(next: View): void {
    setCompletedMode(false);
    setMoreOpen(false);
    setView(
      next?.kind === "list"
        ? {
            ...next,
            mode: next.mode ?? lists.find((list) => list.id === next.id)?.view_mode ?? "list",
          }
        : next,
    );
  }

  /** Keeps `view.mode` (and so /calendar/<mode> — see the sync effect above)
   * matching CalendarView's own internal mode state, without touching
   * completedMode/moreOpen the way a full switchView would. */
  const handleCalendarModeChange = useCallback((mode: CalendarMode): void => {
    setView((current) => (current?.kind === "calendar" ? { kind: "calendar", mode } : current));
  }, []);

  /** Dismisses the Task detail sheet/panel — shared by its Close button, its
   * mobile backdrop, and its swipe-to-dismiss gesture (issue #170), so all
   * three ways out behave identically. Never touches `view`: the detail is
   * an overlay on top of whatever was already showing, so main's scroll
   * position is untouched by opening or closing it. */
  const narrowViewport = useNarrowViewport();
  const sheetOpen = narrowViewport && selectedTaskId !== null;
  // The sheet owns one history entry so the phone's back button dismisses it.
  const sheetEntryRef = useRef(false);
  const ignoreNextPopRef = useRef(false);
  useEffect(() => {
    if (!sheetOpen) {
      return;
    }
    window.history.pushState({ taskSheet: true }, "");
    sheetEntryRef.current = true;
    return () => {
      if (sheetEntryRef.current) {
        sheetEntryRef.current = false;
        const state = window.history.state as { taskSheet?: boolean } | null;
        if (state?.taskSheet === true) {
          ignoreNextPopRef.current = true;
          window.history.back();
        }
      }
    };
  }, [sheetOpen]);

  function closeTaskDetail(): void {
    setSelectedTaskId(null);
    setCalendarTask(null);
  }

  /** Fold a single Task's new state into the open-Task snapshot behind the
   * sidebar counts (issue #195): upsert while it is open, drop it the moment
   * it completes. Used by the direct-Task paths — create, detail edits, a
   * drag between Lists — where the mover hands us the Task itself. */
  const reconcileOpenTask = useCallback((task: Task): void => {
    setOpenTasks((current) => {
      const without = current.filter((existing) => existing.id !== task.id);
      return task.completed ? without : [...without, task];
    });
  }, []);

  /** Fold a view-tasks update into the open-Task snapshot. A Task the update
   * drops from the view (deleted, or completed and filtered out) leaves the
   * snapshot; one it marks completed leaves it; one it adds or reopens joins
   * it. List moves never come through here — they carry the moved Task and
   * go through `reconcileOpenTask` — so a disappearance here is only ever a
   * completion or a delete. */
  const reconcileOpenTasks = useCallback((update: (current: Task[]) => Task[]): void => {
    const before = tasksRef.current;
    const after = update(before);
    const afterById = new Map(after.map((task) => [task.id, task]));
    const beforeIds = new Set(before.map((task) => task.id));
    setOpenTasks((current) => {
      const kept = current.filter((task) => {
        const inView = afterById.get(task.id);
        if (inView !== undefined) {
          return !inView.completed;
        }
        return !beforeIds.has(task.id);
      });
      const keptIds = new Set(kept.map((task) => task.id));
      const joined = after.filter((task) => !task.completed && !keptIds.has(task.id));
      const refreshed = kept.map((task) => afterById.get(task.id) ?? task);
      return [...refreshed, ...joined];
    });
  }, []);

  /** In computed views, apply the optimistic update, then re-run the query —
   * membership is the server's call, not local state's. */
  function changeTasksAndRecompute(update: (current: Task[]) => Task[]): void {
    reconcileOpenTasks(update);
    setTasks(update);
    void loadTasks();
  }

  /** A view-tasks update that also keeps the sidebar open-Task counts in
   * step — the setter handed to every non-computed task view. */
  function changeTasks(update: (current: Task[]) => Task[]): void {
    reconcileOpenTasks(update);
    setTasks(update);
  }

  /** Apply a server response, evicting the task if it left the current view. */
  function applyTaskChange(updated: Task): void {
    setCalendarTask((current) => (current?.id === updated.id ? updated : current));
    reconcileOpenTask(updated);
    if (isComputedView) {
      changeTasksAndRecompute((current) =>
        current.map((task) => (task.id === updated.id ? updated : task)),
      );
      return;
    }
    const stillInView =
      view === null ||
      (view.kind === "list"
        ? updated.list_id === view.id
        : view.kind === "tag"
          ? updated.tags.some((tag) => tag.id === view.id)
          : view.kind === "folder" &&
            lists.some((list) => list.id === updated.list_id && list.folder_id === view.id));
    setTasks((current) =>
      stillInView
        ? current.map((task) => (task.id === updated.id ? updated : task))
        : current.filter((task) => task.id !== updated.id),
    );
  }

  /** What the command palette's Task verbs (issue #205) do. Complete and
   * delete route through the same deferred-PATCH / deferred-DELETE undo path
   * their row equivalents use (#155): the request only fires once the toast
   * window elapses, so Undo is just "never send it" and a recurring Task's
   * completion still branches server-side (ADR 0003). The value-taking verbs
   * PATCH straight away — the palette's picker already gathered the value. */
  /** Fire a PATCH now and fold the response back into the view. The
   * value-taking palette verbs all share this shape — only the patch differs. */
  function patchTaskNow(taskId: number, patch: TaskPatch): void {
    void (async () => applyTaskChange(await updateTask(taskId, patch)))();
  }

  function completeTaskNow(task: Task): void {
    if (task.completed) {
      return;
    }
    toasts.push(
      "Completed",
      async () => applyTaskChange(await updateTask(task.id, { completed: true })),
      () => {},
    );
  }

  function deleteTaskWithUndo(task: Task): void {
    changeTasks((current) => current.filter((t) => t.id !== task.id));
    toasts.push(
      "Task deleted",
      () => deleteTask(task.id),
      () => changeTasks((current) => [...current, task]),
    );
  }

  /** Whether a Task belongs to the view currently on screen. False for a
   * computed view (Today, Search): membership is decided server-side by the
   * query, so we never claim the Task is visible when we can't know. */
  function isInCurrentView(task: Task): boolean {
    if (isComputedView) {
      return false;
    }
    return view?.kind === "list"
      ? task.list_id === view.id
      : view?.kind === "tag"
        ? task.tags.some((tag) => tag.id === view.id)
        : view?.kind === "folder" &&
          lists.some((list) => list.id === task.list_id && list.folder_id === view.id);
  }

  /** Confirms a Task that has just been created, from whichever entry point
   * made it (issue #191). Creating a Task is the app's most frequent write
   * and used to be its only silent one: from Focus or Settings the dialog
   * simply closed, with the Task filed somewhere off-screen.
   *
   * Decision: the create toast carries no Undo. The queue's Undo works by
   * *deferring* the request for `UNDO_WINDOW_MS` (#155), and a create can't
   * be deferred — the caller needs the server-assigned Task back to show it,
   * and the dialog has already closed around it. The alternative, an Undo
   * that DELETEs, is a different operation wearing the same word, and it
   * would discard anything done to the Task inside the window. So the toast
   * answers the question the user actually has instead — where did it go —
   * by naming the List, plus a way there when the Task isn't on screen. */
  /** Opens a Task's detail regardless of the view currently on screen —
   * switching to its List first when it isn't already visible, the same
   * navigation the confirmation toast's "Show Task" action performs. */
  function openTaskDetail(task: Task): void {
    if (!isInCurrentView(task)) {
      switchView({ kind: "list", id: task.list_id });
    }
    setSelectedTaskId(task.id);
    setCalendarTask(task);
  }

  function announceCreated(created: Task): void {
    const listName = lists.find((list) => list.id === created.list_id)?.name;
    // Spoken confirmation (#544): the toast below only exists while shown,
    // and a live region inserted with its text is announced unreliably.
    setSavedAnnouncement((previous) => ({
      text: listName === undefined ? "Task saved" : `Task saved to ${listName}`,
      count: (previous?.count ?? 0) + 1,
    }));
    // Issue #259: prose typed into Quick-Add with no `@` token that reads
    // like a date/time phrase ("dentist tuesday 3pm") saves as a plain,
    // undated title — Quick-Add deliberately does not parse it (CONTEXT.md:
    // no NL date parsing). The confirmation toast is the one guaranteed
    // moment to say so, with a one-click way to correct it without
    // retyping the title. This is a static keyword check on the saved
    // title, never a date extraction.
    if (created.due_date === null && looksLikeDatePhrase(created.title)) {
      toasts.notify(`"${created.title}" — no date set`, {
        label: "Add date",
        run: () => openTaskDetail(created),
      });
      return;
    }
    // With no name to give, say only what is certainly true rather than
    // naming a destination we can't identify.
    const message = listName === undefined ? "Task added" : `Added to ${listName}`;
    toasts.notify(
      message,
      isInCurrentView(created)
        ? undefined
        : {
            label: "Show Task",
            run: () => openTaskDetail(created),
          },
    );
  }

  /** Show a newly created task, but only where it belongs: the dialog can file
   * it into another List, and computed views decide membership server-side. */
  function addCreatedTask(created: Task): void {
    reconcileOpenTask(created);
    if (isComputedView) {
      changeTasksAndRecompute((current) => current);
    } else if (isInCurrentView(created)) {
      setTasks((current) => [...current, created]);
    }
    announceCreated(created);
  }

  /** "Convert to task" (issue #111) already created the Task by the time
   * this runs — close the popover the conversion happened from, and force
   * the Calendar to reload so the Event it replaces disappears immediately. */
  function handleEventConverted(): void {
    setSelectedEvent(null);
    setCalendarRefresh((current) => current + 1);
  }

  /** A renamed/recolored Tag must also update the copies embedded in tasks. */
  function applyTagChange(saved: Tag): void {
    setTags((current) => current.map((tag) => (tag.id === saved.id ? saved : tag)));
    setTasks((current) =>
      current.map((task) => ({
        ...task,
        tags: task.tags.map((tag) => (tag.id === saved.id ? saved : tag)),
      })),
    );
  }

  async function toggleViewMode(list: TaskList): Promise<void> {
    const updated = await updateList(list.id, {
      view_mode: list.view_mode === "kanban" ? "list" : "kanban",
    });
    setLists((current) => current.map((l) => (l.id === updated.id ? updated : l)));
    setView((current) =>
      current?.kind === "list" && current.id === list.id
        ? { ...current, mode: updated.view_mode }
        : current,
    );
  }

  function applyTagDeletion(tagId: number): void {
    setTags((current) => current.filter((tag) => tag.id !== tagId));
    setTasks((current) =>
      current.map((task) => ({
        ...task,
        tags: task.tags.filter((tag) => tag.id !== tagId),
      })),
    );
  }

  // Shared with both the sidebar's top nav and the mobile tab bar (#170),
  // so the two surfaces never disagree about which destination is active.
  const calendarSelected = view?.kind === "calendar";
  const goalsSelected = view?.kind === "goals";
  const habitsSelected = view?.kind === "habits";
  const standupSelected = view?.kind === "standup";
  const assistantSelected = view?.kind === "assistant";
  const focusSelected = view?.kind === "focus" || view?.kind === "focus-stats";
  const searchSelected = view?.kind === "search";

  // The List the open Task belongs to, shown as a breadcrumb in the mobile
  // sheet (#170) — Task detail can be reached from any view (List, Tag,
  // Folder, Smart, Search, Calendar), so this is always resolved against
  // the full `lists` array rather than the currently selected List.
  const selectedTaskListName =
    selectedTask !== null
      ? (lists.find((list) => list.id === selectedTask.list_id)?.name ?? null)
      : null;

  // Sidebar open-Task counts (issue #195), derived from the open Tasks the
  // client holds — scoped to Lists that still exist so a deleted List can't
  // leave a phantom tally behind.
  const openTaskCounts = useMemo(() => {
    const liveListIds = new Set(lists.map((list) => list.id));
    return deriveOpenTaskCounts(
      openTasks.filter((task) => liveListIds.has(task.list_id)),
      localDayOf(new Date()),
    );
  }, [openTasks, lists]);

  // Every jump target the command palette offers (issue #201). Rebuilt each
  // render — cheap, and it keeps every `run` closure current rather than
  // stale. Order here is only within-kind; the palette groups by kind itself.
  const paletteItems: PaletteItem[] = [
    ...(Object.keys(SMART_LABELS) as SmartView[]).map((smart) => ({
      key: `smart-${smart}`,
      kind: "smart" as const,
      label: SMART_LABELS[smart],
      run: () => switchView({ kind: "smart", view: smart }),
    })),
    ...(sectionSettings.calendar
      ? [
          {
            key: "view-calendar",
            kind: "view" as const,
            label: "Calendar",
            run: () => switchView({ kind: "calendar", mode: "day" }),
          },
        ]
      : []),
    ...(sectionSettings.goals
      ? [
          {
            key: "view-goals",
            kind: "view" as const,
            label: "Goals",
            run: () => switchView({ kind: "goals" }),
          },
        ]
      : []),
    ...(sectionSettings.habits
      ? [
          {
            key: "view-habits",
            kind: "view" as const,
            label: "Habits",
            run: () => switchView({ kind: "habits" }),
          },
        ]
      : []),
    ...(standupEnabled
      ? [
          {
            key: "view-standup",
            kind: "view" as const,
            label: "Stand-up",
            run: () => switchView({ kind: "standup" }),
          },
        ]
      : []),
    ...(assistantAvailable
      ? [
          {
            key: "view-assistant",
            kind: "view" as const,
            label: "Assistant",
            run: () => switchView({ kind: "assistant" }),
          },
        ]
      : []),
    ...(sectionSettings.focus
      ? [
          {
            key: "view-focus",
            kind: "view" as const,
            label: "Focus",
            run: () => switchView({ kind: "focus" }),
          },
        ]
      : []),
    {
      key: "view-search",
      kind: "view" as const,
      label: "Search",
      run: () => switchView({ kind: "search", search: BLANK_SEARCH_STATE }),
    },
    {
      key: "view-settings",
      kind: "view" as const,
      label: "Settings",
      run: () => switchView({ kind: "settings", tab: "account" }),
    },
    ...lists
      .filter((list) => !list.is_archived)
      .map((list) => ({
        key: `list-${list.id}`,
        kind: "list" as const,
        label: list.name,
        run: () => switchView({ kind: "list", id: list.id }),
      })),
    ...folders.map((folder) => ({
      key: `folder-${folder.id}`,
      kind: "folder" as const,
      label: folder.name,
      run: () => switchView({ kind: "folder", id: folder.id }),
    })),
    ...tags.map((tag) => ({
      key: `tag-${tag.id}`,
      kind: "tag" as const,
      label: `#${tag.name}`,
      run: () => switchView({ kind: "tag", id: tag.id }),
    })),
    ...openTasks.map((task) => ({
      key: `task-${task.id}`,
      kind: "task" as const,
      label: task.title,
      run: () => {
        switchView({ kind: "list", id: task.list_id });
        setSelectedTaskId(task.id);
        setCalendarTask(task);
      },
    })),
  ];

  return (
    <VoiceProvider
      createTransport={voiceProvider.transport}
      refresh={refreshAfterVoiceWrite}
      available={voiceStatus}
    >
      <FocusRunProvider>
        <ShortcutsProvider>
          <ShellShortcuts
            onQuickAdd={() => setQuickAddOpen(true)}
            onOpenPalette={() => setPaletteOpen(true)}
          />
          <VoiceOverlay available={voiceAvailable} navigation={view} />
          {(paletteOpen || paletteTask !== null) && (
            <TaskPalette
              task={paletteTask ?? undefined}
              focusEnabled={sectionSettings.focus}
              items={paletteItems}
              lists={lists}
              tags={tags}
              defaultListId={
                selectedList?.id ?? lists.find((list) => list.is_inbox)?.id ?? lists[0]?.id ?? 0
              }
              actions={{
                onComplete: completeTaskNow,
                onOpenFocus: (task) => switchView({ kind: "focus", task }),
                onReschedule: (task, day) =>
                  patchTaskNow(
                    task.id,
                    day === null ? clearedSchedule() : rescheduledToDay(task, day),
                  ),
                onMove: (task, listId) => patchTaskNow(task.id, { list_id: listId }),
                onAddTag: (task, tagId) =>
                  patchTaskNow(task.id, {
                    tag_ids: [...new Set([...task.tags.map((tag) => tag.id), tagId])],
                  }),
                onSetRepeat: (task, recurrence) => patchTaskNow(task.id, { recurrence }),
                onDelete: deleteTaskWithUndo,
              }}
              onTagCreated={(tag) => setTags((current) => [...current, tag])}
              onListCreated={(list) => setLists((current) => [...current, list])}
              onCreated={addCreatedTask}
              onClose={() => {
                setPaletteOpen(false);
                setPaletteTask(null);
              }}
            />
          )}
          <div
            className={[
              "app",
              selectedTask === null ? "" : "with-detail",
              sidebarCollapsed ? "sidebar-collapsed" : "",
            ]
              .filter((name) => name !== "")
              .join(" ")}
          >
            <Sidebar
              lists={lists}
              folders={folders}
              tags={tags}
              selectedListId={view?.kind === "list" ? view.id : null}
              selectedTagId={view?.kind === "tag" ? view.id : null}
              selectedFolderId={view?.kind === "folder" ? view.id : null}
              selectedSmart={smartView}
              smartOpenCounts={openTaskCounts.smart}
              listOpenCounts={openTaskCounts.byList}
              calendarSelected={calendarSelected}
              calendarEnabled={sectionSettings.calendar}
              goalsSelected={goalsSelected}
              goalsEnabled={sectionSettings.goals}
              habitsSelected={habitsSelected}
              habitsEnabled={sectionSettings.habits}
              standupSelected={standupSelected}
              standupEnabled={standupEnabled}
              assistantSelected={assistantSelected}
              assistantAvailable={assistantAvailable}
              focusSelected={focusSelected}
              focusEnabled={sectionSettings.focus}
              onSelect={(listId) => switchView({ kind: "list", id: listId })}
              onSelectFolder={(folderId) => switchView({ kind: "folder", id: folderId })}
              onSelectTag={(tagId) => switchView({ kind: "tag", id: tagId })}
              onSelectSmart={(smart) => switchView({ kind: "smart", view: smart })}
              onSelectCalendar={() => switchView({ kind: "calendar", mode: "day" })}
              onSelectGoals={() => switchView({ kind: "goals" })}
              onSelectHabits={() => switchView({ kind: "habits" })}
              onSelectStandup={() => switchView({ kind: "standup" })}
              onSelectAssistant={() => switchView({ kind: "assistant" })}
              onSelectFocus={() => switchView({ kind: "focus" })}
              onQuickAdd={() => setQuickAddOpen(true)}
              collapsed={sidebarCollapsed}
              onToggleCollapsed={toggleSidebar}
              onOpenPalette={() => setPaletteOpen(true)}
              onListsChanged={setLists}
              onFoldersChanged={setFolders}
              onTagCreated={(tag) => setTags((current) => [...current, tag])}
              onTagSaved={applyTagChange}
              onTagDeleted={applyTagDeletion}
              onTaskMoved={(moved) => {
                reconcileOpenTask(moved);
                setTasks((current) =>
                  view?.kind === "list" && moved.list_id !== view.id
                    ? current.filter((task) => task.id !== moved.id)
                    : current.map((task) => (task.id === moved.id ? moved : task)),
                );
              }}
            />
            <main ref={mainRef}>
              {/* One cell for the view, one for the hint strip: the cell grows
              into spare height so the strip sits at the foot (issue #434). */}
              <div className={showDayRail ? "main-content with-day-rail" : "main-content"}>
                <div className="main-chrome">
                  <div className="main-header">
                    <h1>
                      {selectedList !== null ? (
                        // A List filed in a Folder shows "Folder / List" (#126): the
                        // Folder segment is clickable through to the Folder view,
                        // same destination as clicking the Folder's name in the
                        // sidebar.
                        parentFolder !== null ? (
                          <>
                            <button
                              type="button"
                              className="breadcrumb-folder"
                              onClick={() => switchView({ kind: "folder", id: parentFolder.id })}
                            >
                              {parentFolder.name}
                            </button>
                            <span aria-hidden="true"> / </span>
                            {selectedList.name}
                          </>
                        ) : (
                          selectedList.name
                        )
                      ) : selectedFolder !== null ? (
                        selectedFolder.name
                      ) : selectedTag !== null ? (
                        `#${selectedTag.name}`
                      ) : smartView !== null ? (
                        SMART_LABELS[smartView]
                      ) : view?.kind === "calendar" ? (
                        "Calendar"
                      ) : view?.kind === "goals" ? (
                        "Goals"
                      ) : view?.kind === "habits" ? (
                        "Habits"
                      ) : view?.kind === "standup" ? (
                        "Stand-up"
                      ) : view?.kind === "assistant" ? (
                        "Assistant"
                      ) : view?.kind === "focus" ? (
                        "Focus"
                      ) : view?.kind === "focus-stats" ? (
                        "Focus statistics"
                      ) : view?.kind === "search" ? (
                        "Search"
                      ) : view?.kind === "settings" ? (
                        "Settings"
                      ) : (
                        "tuk-tuk"
                      )}
                    </h1>
                    {smartView === "today" &&
                      !completedMode &&
                      (() => {
                        const open = visibleTasks.filter((task) => !task.completed);
                        const minutes =
                          groupTodayTasks(open, "custom")
                            .find((group) => group.key === "today-Schedule")
                            ?.tasks.reduce((sum, task) => sum + (durationMinutes(task) ?? 0), 0) ??
                          0;
                        return (
                          <p className="today-summary">
                            {formatDate(new Date(), "weekdayLong")} · {open.length} open Tasks
                            {minutes > 0
                              ? ` · ${Math.floor(minutes / 60)}h ${minutes % 60}m planned`
                              : ""}
                          </p>
                        );
                      })()}
                    {selectedList !== null && !completedMode && (
                      <button
                        type="button"
                        className="view-toggle"
                        aria-label={
                          selectedList.view_mode === "kanban"
                            ? "Switch to list view"
                            : "Switch to kanban view"
                        }
                        onClick={() => void toggleViewMode(selectedList)}
                      >
                        {selectedList.view_mode === "kanban" ? "List view" : "Kanban view"}
                      </button>
                    )}
                    {showHideCompletedToggle && (
                      <button
                        type="button"
                        className="hide-completed-toggle"
                        aria-pressed={hideCompleted}
                        onClick={() =>
                          setHideCompleted((current) => {
                            const next = !current;
                            saveHideCompleted(next);
                            return next;
                          })
                        }
                      >
                        {hideCompleted ? "Show completed" : "Hide completed"}
                      </button>
                    )}
                    {hasCompletedView && (
                      <button
                        type="button"
                        className="completed-toggle"
                        onClick={() => {
                          setCompletedMode(!completedMode);
                          if (view?.kind === "list")
                            setView({
                              ...view,
                              mode: completedMode
                                ? (lists.find((list) => list.id === view.id)?.view_mode ?? "list")
                                : "completed",
                            });
                        }}
                      >
                        {completedMode ? "Open tasks" : "Completed"}
                      </button>
                    )}
                    {currentUser !== null && (
                      <UserMenu
                        user={currentUser}
                        onSelectTab={(tab) => switchView({ kind: "settings", tab })}
                        darkMode={resolveThemePreference(themePreference) === "dark"}
                        onToggleDarkMode={toggleTheme}
                        onLogout={onLogout}
                      />
                    )}
                  </div>
                  {/* Full-width row under the header: only .view-controls takes the
                  right-hand column of .main-chrome on a phone. */}
                  {showHabitStrip && <HabitStrip habits={todayHabits} />}
                  {selectedList !== null && selectedList.view_mode === "list" && !completedMode && (
                    <>
                      <QuickAdd
                        listId={selectedList.id}
                        lists={lists}
                        tags={tags}
                        onTagCreated={(tag) => setTags((current) => [...current, tag])}
                        onListCreated={(list) => setLists((current) => [...current, list])}
                        // A ~list token may have filed the task elsewhere; the shared
                        // handler already accounts for that, and confirms either way.
                        onCreated={addCreatedTask}
                      />
                      <ViewMenu
                        groupBy={groupBy}
                        onGroupByChange={setGroupBy}
                        groupOptions={LIST_GROUP_OPTIONS}
                        sortBy={sortBy}
                        onSortByChange={setSortBy}
                        lists={lists}
                        tags={tags}
                      />
                    </>
                  )}
                  {smartView !== null && !completedMode && (
                    <ViewMenu
                      groupOptions={SMART_GROUP_OPTIONS}
                      filters={allFilters}
                      onFiltersUpdate={setAllFilters}
                      groupBy={groupBy}
                      onGroupByChange={setGroupBy}
                      sortBy={sortBy}
                      onSortByChange={setSortBy}
                      lists={lists}
                      tags={tags}
                    />
                  )}
                  {selectedFolder !== null && !completedMode && folderMembers.length > 0 && (
                    <>
                      {/* Quick-Add has no notion of "this Folder" — it always files
                  by List, so it targets the Folder's first List and names
                  it in the placeholder (#126) since that target isn't the
                  one on screen. */}
                      <QuickAdd
                        listId={folderMembers[0]?.id ?? 0}
                        lists={lists}
                        tags={tags}
                        placeholder={`Add a task to ${folderMembers[0]?.name}…`}
                        onTagCreated={(tag) => setTags((current) => [...current, tag])}
                        onListCreated={(list) => setLists((current) => [...current, list])}
                        onCreated={(task) => {
                          reconcileOpenTask(task);
                          // A ~list token may have filed the task elsewhere in the Folder.
                          if (folderMembers.some((list) => list.id === task.list_id)) {
                            setTasks((current) => [...current, task]);
                          }
                        }}
                      />
                      <div className="view-controls">
                        <label>
                          Sort by
                          <select
                            value={folderSortBy}
                            onChange={(event) =>
                              setFolderSortBy(event.target.value as FolderSortBy)
                            }
                          >
                            <option value="date">Date</option>
                            <option value="priority">Priority</option>
                            <option value="title">Title</option>
                          </select>
                        </label>
                      </div>
                    </>
                  )}
                </div>
                {quickAddOpen && (
                  <Modal title="Quick add" onClose={() => setQuickAddOpen(false)}>
                    <QuickAddDialog
                      lists={lists}
                      tags={tags}
                      defaultListId={selectedList?.id ?? null}
                      onTagCreated={(tag) => setTags((current) => [...current, tag])}
                      onListCreated={(list) => setLists((current) => [...current, list])}
                      onCreated={addCreatedTask}
                      onClose={() => setQuickAddOpen(false)}
                    />
                  </Modal>
                )}
                {/* A loaded Task view with nothing in it (#441); List and
                Folder views still render beneath it, keeping their Add
                Section control and List headings. */}
                {taskViewStatus === "ready" && emptyTaskView !== null && (
                  <EmptyState
                    title={emptyTaskView.title}
                    description={emptyTaskView.description}
                    actionLabel="New task"
                    onAction={() => setQuickAddOpen(true)}
                  />
                )}
                {view?.kind === "settings" ? (
                  <SettingsView
                    tab={view.tab}
                    onTabChange={showSettingsTab}
                    onUserChange={setCurrentUser}
                    googleOAuthError={googleOAuthError}
                    themePreference={themePreference}
                    onThemeChange={chooseTheme}
                  />
                ) : view?.kind === "calendar" ? (
                  <CalendarView
                    onSelect={(task) => {
                      setCalendarTask(task);
                      setSelectedTaskId(task.id);
                    }}
                    onSelectEvent={setSelectedEvent}
                    refreshToken={calendarRefresh}
                    lists={lists}
                    tags={tags}
                    onTagCreated={(tag) => setTags((current) => [...current, tag])}
                    onListCreated={(list) => setLists((current) => [...current, list])}
                    initialMode={view.mode}
                    onModeChange={handleCalendarModeChange}
                    undoQueue={toasts}
                  />
                ) : view?.kind === "goals" ? (
                  <GoalsView />
                ) : view?.kind === "habits" ? (
                  <HabitsView refreshToken={habitsRefresh} />
                ) : view?.kind === "standup" ? (
                  <StandupView />
                ) : view?.kind === "assistant" ? (
                  <AssistantPage
                    textAvailable={textAssistantAvailable}
                    voiceAvailable={voiceAvailable}
                  />
                ) : view?.kind === "focus" ? (
                  <FocusView
                    key={view.task?.id ?? "focus"}
                    initialTask={view.task ?? null}
                    onOpenStats={() => switchView({ kind: "focus-stats" })}
                  />
                ) : view?.kind === "focus-stats" ? (
                  <FocusStatsView onBack={() => switchView({ kind: "focus" })} />
                ) : view?.kind === "search" ? (
                  <SearchView
                    tasks={tasks}
                    loadStatus={taskViewStatus}
                    onRetry={() => void loadTasks()}
                    lists={lists}
                    tags={tags}
                    state={view.search}
                    onStateChange={(search) => switchView({ kind: "search", search })}
                    onChanged={changeTasksAndRecompute}
                    onSelect={setSelectedTaskId}
                  />
                ) : taskViewStatus === "loading" ? (
                  <SkeletonRows />
                ) : taskViewStatus === "error" ? (
                  <LoadError what={taskViewName} onRetry={() => void loadTasks()} />
                ) : selectedFolder !== null ? (
                  <FolderView
                    folder={selectedFolder}
                    lists={folderMembers}
                    tasks={visibleTasks}
                    sortBy={folderSortBy}
                    onChanged={changeTasks}
                    onSelect={setSelectedTaskId}
                    onSelectList={(listId) => switchView({ kind: "list", id: listId })}
                    onOpenFocus={(task) => switchView({ kind: "focus", task })}
                  />
                ) : completedMode ? (
                  <CompletedView
                    tasks={tasks}
                    occurrences={occurrences}
                    listId={selectedList?.id ?? null}
                    onChanged={changeTasksAndRecompute}
                    onSelect={setSelectedTaskId}
                  />
                ) : selectedList !== null && selectedList.view_mode === "kanban" ? (
                  <KanbanView
                    tasks={visibleTasks}
                    sections={sections}
                    listId={selectedList.id}
                    onChanged={changeTasks}
                    onSelect={setSelectedTaskId}
                    onSectionsChanged={setSections}
                    toasts={toasts}
                    onCreated={announceCreated}
                  />
                ) : (
                  <TaskListView
                    tasks={visibleTasks}
                    sections={sections}
                    listId={smartView !== null ? null : (selectedList?.id ?? null)}
                    lists={lists}
                    tags={tags}
                    viewKey={viewKey}
                    groupBy={groupBy}
                    sortBy={sortBy}
                    todaySections={smartView === "today" && groupBy === "section"}
                    scheduleTimeline={
                      smartView === "today" &&
                      groupBy === "section" &&
                      sortBy !== "title" &&
                      sortBy !== "priority"
                    }
                    dateContext={
                      smartView === "today" ? "today" : smartView === "next7" ? "week" : "absolute"
                    }
                    onChanged={smartView !== null ? changeTasksAndRecompute : changeTasks}
                    onSelect={setSelectedTaskId}
                    onSectionsChanged={setSections}
                    onOpenActions={setPaletteTask}
                    onFocusTask={
                      sectionSettings.focus
                        ? (task) => switchView({ kind: "focus", task })
                        : undefined
                    }
                    toasts={toasts}
                  />
                )}
                {showDayRail && (
                  <DayRail>
                    {sectionSettings.goals && (
                      <FocusedGoalCard
                        goalsHref={pathForStaticView("goals")}
                        onOpenGoals={() => switchView({ kind: "goals" })}
                      />
                    )}
                    {sectionSettings.habits && (
                      <HabitsCard
                        habits={todayHabits}
                        habitsHref={pathForStaticView("habits")}
                        onOpenHabits={() => switchView({ kind: "habits" })}
                      />
                    )}
                    {sectionSettings.focus && (
                      <FocusCard
                        focusHref={pathForStaticView("focus")}
                        onOpenFocus={() => switchView({ kind: "focus" })}
                      />
                    )}
                  </DayRail>
                )}
              </div>
              {/* The shortcut hint strip lives at the foot of main; it reads
              the live registry, so later slices that register shortcuts
              appear here automatically (issue #192). */}
              <ShortcutHints />
            </main>
            <MobileTabBar
              todaySelected={smartView === "today"}
              calendarSelected={calendarSelected}
              calendarEnabled={sectionSettings.calendar}
              habitsSelected={habitsSelected}
              habitsEnabled={sectionSettings.habits}
              moreSelected={
                view !== null && smartView !== "today" && !calendarSelected && !habitsSelected
              }
              moreOpen={moreOpen}
              onSelectToday={() => switchView({ kind: "smart", view: "today" })}
              onSelectCalendar={() => switchView({ kind: "calendar", mode: "day" })}
              onQuickAdd={() => {
                setMoreOpen(false);
                setQuickAddOpen(true);
              }}
              onSelectHabits={() => switchView({ kind: "habits" })}
              onToggleMore={() => setMoreOpen((current) => !current)}
            />
            {moreOpen && (
              <MoreSheet
                lists={lists}
                folders={folders}
                tags={tags}
                selectedListId={view?.kind === "list" ? view.id : null}
                selectedFolderId={view?.kind === "folder" ? view.id : null}
                selectedTagId={view?.kind === "tag" ? view.id : null}
                selectedSmart={smartView}
                goalsEnabled={sectionSettings.goals}
                goalsSelected={goalsSelected}
                focusEnabled={sectionSettings.focus}
                focusSelected={focusSelected}
                standupEnabled={standupEnabled}
                standupSelected={standupSelected}
                assistantAvailable={assistantAvailable}
                assistantSelected={assistantSelected}
                searchSelected={searchSelected}
                settingsTab={view?.kind === "settings" ? view.tab : null}
                user={currentUser}
                darkMode={resolveThemePreference(themePreference) === "dark"}
                onToggleDarkMode={toggleTheme}
                onLogout={onLogout}
                onClose={closeMore}
                onSelectSmart={(smart) => switchView({ kind: "smart", view: smart })}
                onSelectList={(listId) => switchView({ kind: "list", id: listId })}
                onSelectFolder={(folderId) => switchView({ kind: "folder", id: folderId })}
                onSelectTag={(tagId) => switchView({ kind: "tag", id: tagId })}
                onSelectGoals={() => switchView({ kind: "goals" })}
                onSelectFocus={() => switchView({ kind: "focus" })}
                onSelectStandup={() => switchView({ kind: "standup" })}
                onSelectAssistant={() => switchView({ kind: "assistant" })}
                onSelectSearch={() => switchView({ kind: "search", search: BLANK_SEARCH_STATE })}
                onSelectSettingsTab={(tab) => switchView({ kind: "settings", tab })}
              />
            )}
            {selectedTask !== null && (
              <div className="task-detail-backdrop" aria-hidden="true" onClick={closeTaskDetail} />
            )}
            {selectedTask !== null && (
              <TaskDetail
                task={selectedTask}
                allTags={tags}
                listName={selectedTaskListName}
                lists={lists}
                onTaskChanged={applyTaskChange}
                onTagCreated={(tag) => setTags((current) => [...current, tag])}
                onClose={closeTaskDetail}
                sheet={narrowViewport}
                onOpenFocus={
                  sectionSettings.focus
                    ? (task) => {
                        closeTaskDetail();
                        switchView({ kind: "focus", task });
                      }
                    : undefined
                }
                onDelete={(task) => {
                  closeTaskDetail();
                  deleteTaskWithUndo(task);
                }}
              />
            )}
            {selectedEvent !== null && (
              <Modal title={selectedEvent.title} onClose={() => setSelectedEvent(null)}>
                <EventDetail event={selectedEvent} onConverted={handleEventConverted} />
              </Modal>
            )}
            {/* The app's only toast stack. It sits here, outside <main>, so a
            toast raised from Quick add covers Focus, Settings and Calendar
            too — the task views used to each own one and could only cover
            themselves (#191). */}
            <ToastStack entries={toasts.entries} onUndo={toasts.undo} onDismiss={toasts.dismiss} />
            {/* Always mounted, so a Task-saved confirmation lands in a region
            the screen reader already watches. No role="status": the toasts
            own that role, and tests (and users) find them by it. */}
            <div className="visually-hidden" aria-live="polite" aria-atomic="true">
              {savedAnnouncement !== null && (
                <span key={savedAnnouncement.count}>{savedAnnouncement.text}</span>
              )}
            </div>
          </div>
        </ShortcutsProvider>
      </FocusRunProvider>
    </VoiceProvider>
  );
}

/** The command palette plus the Task verbs it offers (issue #205) — a
 * module-scope child of FocusRunProvider so `onStartPomo` can reach the
 * focus-run context. Props carry every closure it needs, so each stays
 * current without re-creating a component type per render. */
function TaskPalette({
  task,
  focusEnabled,
  items,
  lists,
  tags,
  defaultListId,
  actions: verbs,
  onTagCreated,
  onListCreated,
  onCreated,
  onClose,
}: {
  task: Task | undefined;
  focusEnabled: boolean;
  items: PaletteItem[];
  lists: TaskList[];
  tags: Tag[];
  defaultListId: number;
  actions: Omit<TaskActionHandlers, "onStartPomo">;
  onTagCreated: (tag: Tag) => void;
  onListCreated: (list: TaskList) => void;
  onCreated: (task: Task) => void;
  onClose: () => void;
}): React.JSX.Element {
  const startPomo = useStartPomo();
  const actions: TaskActionHandlers = {
    ...verbs,
    onStartPomo: (task, pomoMs) => void startPomo(task.id, pomoMs),
  };
  return (
    <CommandPalette
      items={items}
      task={task}
      focusEnabled={focusEnabled}
      lists={lists}
      tags={tags}
      actions={actions}
      defaultListId={defaultListId}
      onTagCreated={onTagCreated}
      onListCreated={onListCreated}
      onCreated={onCreated}
      onClose={onClose}
    />
  );
}

/** Registers the shell's own shortcuts against the layer (issue #192). Kept a
 * child of App so it sits inside ShortcutsProvider; the scope guard on this
 * slice is deliberate — the command palette, row navigation and per-Task
 * verbs are separate slices that register against this layer rather than
 * adding their own listeners. */
function ShellShortcuts({
  onQuickAdd,
  onOpenPalette,
}: {
  onQuickAdd: () => void;
  onOpenPalette: () => void;
}): null {
  useRegisterShortcut({ key: "n", label: "N", description: "Quick add", run: onQuickAdd });
  useRegisterShortcut({
    key: "/",
    label: "/",
    description: "Search",
    run: onOpenPalette,
  });
  return null;
}
