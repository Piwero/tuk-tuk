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
  fetchTags,
  fetchTasks,
  fetchTasksByTag,
  updateList,
  SMART_LABELS,
  type AllFilters,
  type CompletedOccurrence,
  type Event,
  type Folder,
  type Priority,
  type Section,
  type SmartView,
  type Tag,
  type Task,
  type TaskList,
} from "./api";
import { type CalendarMode } from "./calendar";
import { localDayOf } from "./dates";
import { FocusRunProvider } from "./focusRunContext";
import { PRIORITY_LABELS, type GroupBy, type SortBy } from "./grouping";
import {
  applyThemePreference,
  loadSidebarCollapsed,
  loadThemePreference,
  saveSidebarCollapsed,
  saveThemePreference,
  type ThemePreference,
} from "./layoutPrefs";
import {
  calendarModeForPath,
  pathForCalendarMode,
  pathForSmartView,
  pathForStaticView,
  smartViewForPath,
  staticViewKindForPath,
  type StaticViewKind,
} from "./routes";
import { deriveOpenTaskCounts } from "./openCounts";
import { type PaletteItem } from "./commandPalette";
import { useRegisterShortcut } from "./shortcuts";
import { useUndoQueue } from "./undoQueue";
import { useAssistantAvailable } from "./useAssistantAvailable";
import { AssistantView } from "./components/AssistantView";
import { CalendarView } from "./components/CalendarView";
import { CommandPalette } from "./components/CommandPalette";
import { CompletedView } from "./components/CompletedView";
import { EventDetail } from "./components/EventDetail";
import { FocusStatsView } from "./components/FocusStatsPanel";
import { FocusView } from "./components/FocusView";
import { FolderView, type FolderSortBy } from "./components/FolderView";
import { HabitsView } from "./components/HabitsView";
import { Icon } from "./components/Icon";
import { KanbanView } from "./components/KanbanView";
import { MobileTabBar } from "./components/MobileTabBar";
import { Modal } from "./components/Modal";
import { QuickAdd } from "./components/QuickAdd";
import { QuickAddDialog } from "./components/QuickAddDialog";
import { SearchView, type SearchState } from "./components/SearchView";
import { SettingsView } from "./components/SettingsView";
import { ShortcutHints, ShortcutsProvider } from "./components/ShortcutLayer";
import { Sidebar } from "./components/Sidebar";
import { StandupView } from "./components/StandupView";
import { TaskDetail } from "./components/TaskDetail";
import { TaskListView } from "./components/TaskListView";
import { ToastStack } from "./components/ToastStack";

/** What the main pane shows: one List, one Tag, one Folder (its Tasks across
 * every List it contains — #126), one computed Smart List, the Calendar /
 * Habits / Focus screens (which fetch their own data), or Search results. A
 * focus view may carry the Task to start a Pomo against. */
type View =
  | { kind: "list"; id: number }
  | { kind: "tag"; id: number }
  | { kind: "folder"; id: number }
  | { kind: "smart"; view: SmartView }
  | { kind: "calendar"; mode: CalendarMode }
  | { kind: "habits" }
  | { kind: "standup" }
  | { kind: "assistant" }
  | { kind: "focus"; task?: Task }
  | { kind: "focus-stats" }
  | { kind: "search"; search: SearchState }
  | { kind: "settings" }
  | null;

/** A stable identity for a View, for use as an effect dependency: two Views
 * with the same key show the same screen. Kept next to `View` so the encoding
 * moves with the type it encodes. */
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
const BLANK_ALL_FILTERS: AllFilters = { listId: null, tagId: null, priority: null };

/** Which of the URL-addressable static views (if any) a View shows —
 * List/Tag/Folder views have no path, so this is null for them. */
function staticViewKindOf(view: View): StaticViewKind | null {
  if (
    view?.kind === "calendar" ||
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
 * etc.), defaulting to Day and All respectively. */
function viewForStaticKind(kind: StaticViewKind, pathname: string): View {
  switch (kind) {
    case "search":
      return { kind: "search", search: BLANK_SEARCH_STATE };
    case "calendar":
      return { kind: "calendar", mode: calendarModeForPath(pathname) ?? "day" };
    case "smart":
      return { kind: "smart", view: smartViewForPath(pathname) ?? "all" };
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
      return { kind: "settings" };
  }
}

interface AppProps {
  /** Absent in tests that render App on its own — AuthGate is the only
   * caller that supplies it, so App's bootstrap and tests never need to
   * know authentication exists beyond forwarding this one callback. */
  onLogout?: () => void;
}

export function App({ onLogout }: AppProps = {}): JSX.Element {
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
    return kind !== null ? viewForStaticKind(kind, window.location.pathname) : null;
  });
  // The completed view of the current List (or of All): computed, newest first.
  const [completedMode, setCompletedMode] = useState(false);
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadSidebarCollapsed);
  // Appearance (issue #193) — a browser-local preference, like the collapsed
  // state above. The resolved `data-theme` is (re)applied on every change,
  // and "system" keeps a live subscription to the OS setting.
  const [themePreference, setThemePreference] = useState<ThemePreference>(loadThemePreference);
  // Mobile only: below the breakpoint the sidebar is off-canvas and this
  // slides it over the content. Ignored by the desktop layout.
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Whether the Stand-up nav item/route is shown (issue #140) — fetched once
  // at load, defaulting to true so the nav item doesn't flash away on a slow
  // network before the real value arrives.
  const [standupEnabled, setStandupEnabled] = useState(true);
  // Whether the Assistant nav item/route is shown (ADR 0009, issue #185):
  // polled on load and window refocus, mirroring Quick-Add's Assist gate.
  // No settings toggle — unlike Stand-up, this is never independently
  // configurable, only a direct read of whether a provider is configured.
  // `null` while the probe is still in flight: an affordance needs a
  // settled `true`, but the route guard below must not act on anything but
  // a settled `false`, or a hard load of /assistant redirects itself away
  // before the answer arrives.
  const assistantStatus = useAssistantAvailable();
  const assistantAvailable = assistantStatus === true;
  const [groupBy, setGroupBy] = useState<GroupBy>("section");
  const [sortBy, setSortBy] = useState<SortBy>("custom");
  // The Folder view's own sort preference (#126) — kept separate from the
  // List view's `sortBy` above so visiting one never disturbs the other,
  // and restricted to date/priority/title: there's no manual cross-List
  // order to preserve, so "custom" isn't offered here.
  const [folderSortBy, setFolderSortBy] = useState<FolderSortBy>("date");
  // "All" Smart List's own List/Tag/Priority narrowing (this feature) — kept
  // separate from Search's filters so the two never disturb each other.
  const [allFilters, setAllFilters] = useState<AllFilters>(BLANK_ALL_FILTERS);

  // Lands here after the Google OAuth round trip (app.routers.v1.google
  // redirects to this origin with one of these markers): open Settings
  // straight away so the result is visible without an extra click, and
  // strip the marker so it doesn't linger in the address bar.
  const [googleOAuthError, setGoogleOAuthError] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("googleConnected") || params.has("googleError")) {
      setView({ kind: "settings" });
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
  const lastSyncedKindRef = useRef<StaticViewKind | null>(
    staticViewKindForPath(window.location.pathname),
  );
  const suppressNextSyncRef = useRef(false);

  // An unrecognized path redirects to "/" (falling into the Inbox-fallback
  // effect below) — recognized paths are already handled by `view`'s
  // initial state above.
  useEffect(() => {
    if (
      staticViewKindForPath(window.location.pathname) === null &&
      window.location.pathname !== "/"
    ) {
      window.history.replaceState(null, "", "/");
    }
  }, []);

  // Back/Forward between visited static views (and back to "/" for
  // everything else, which the Inbox-fallback effect resolves from there).
  useEffect(() => {
    function onPopState(): void {
      const kind = staticViewKindForPath(window.location.pathname);
      suppressNextSyncRef.current = true;
      setCompletedMode(false);
      setDrawerOpen(false);
      setView(kind !== null ? viewForStaticKind(kind, window.location.pathname) : null);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Keeps the address bar in sync with `view`: pushes a new entry on
  // navigating into a (different) static view, replaces back to "/" on
  // navigating away to a List/Tag/Folder/Smart view, and does neither for a
  // change within the same static view (e.g. editing Search's filters) or
  // one that came from the URL itself (handled above).
  useEffect(() => {
    const kind = staticViewKindOf(view);
    if (suppressNextSyncRef.current) {
      suppressNextSyncRef.current = false;
      lastSyncedKindRef.current = kind;
      return;
    }
    if (kind === lastSyncedKindRef.current) {
      return;
    }
    lastSyncedKindRef.current = kind;
    if (kind === "calendar" && view?.kind === "calendar") {
      window.history.pushState(null, "", pathForCalendarMode(view.mode));
    } else if (kind === "smart" && view?.kind === "smart") {
      window.history.pushState(null, "", pathForSmartView(view.view));
    } else if (kind !== null) {
      window.history.pushState(null, "", pathForStaticView(kind));
    } else if (window.location.pathname !== "/") {
      window.history.replaceState(null, "", "/");
    }
  }, [view]);

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
      },
    );
  }, []);

  useEffect(() => {
    void fetchStandupSettings().then((settings) => setStandupEnabled(settings.enabled));
  }, []);

  // The command palette (issue #201): cmd/ctrl+K from anywhere, including a
  // focused text field or an open dialog — this is a raw listener rather than
  // a registration against the shortcut layer precisely so the typing-context
  // suppression there doesn't apply.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Keep a valid view: default to All, and fall back to it when the viewed
  // list or tag disappears (e.g. it was deleted).
  useEffect(() => {
    if (view?.kind === "standup" && !standupEnabled) {
      // The feature was turned off (or already was, on load) while this
      // route was showing — fall through to the same Inbox fallback as a
      // deleted List/Tag/Folder, rather than leaving an inaccessible route
      // selected in the sidebar.
    } else if (view?.kind === "assistant" && assistantStatus === false) {
      // Same fallback, for the Assistant becoming (or already being)
      // unconfigured while this route was showing.
    } else if (
      view?.kind === "smart" ||
      view?.kind === "calendar" ||
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
    const next: View = { kind: "smart", view: "all" };
    setCompletedMode(false);
    // Guard against a stale closure: a view switch may land between this
    // effect's render and it running (e.g. the user clicks Calendar just as
    // the lists load). Never stomp a view that changed in the meantime.
    setView((current) => (current === view ? next : current));
  }, [lists, tags, folders, view, standupEnabled, assistantStatus]);

  /** Fetch what the current view shows. Smart Lists and the completed view are
   * computed queries, so edits re-run this rather than patching local state. */
  const loadTasks = useCallback(async (): Promise<void> => {
    if (
      view === null ||
      view.kind === "calendar" ||
      view.kind === "habits" ||
      view.kind === "standup" ||
      view.kind === "assistant" ||
      view.kind === "focus" ||
      view.kind === "focus-stats" ||
      view.kind === "settings"
    ) {
      return;
    }
    if (completedMode) {
      const scope = view.kind === "list" ? view.id : null;
      const [completedPage, occurrencePage] = await Promise.all([
        fetchCompletedTasks(scope),
        fetchCompletedOccurrences(scope),
      ]);
      setTasks(completedPage.items);
      setOccurrences(occurrencePage.items);
    } else if (view.kind === "smart") {
      const filters = view.view === "all" ? allFilters : BLANK_ALL_FILTERS;
      setTasks((await fetchSmartTasks(view.view, localDayOf(new Date()), filters)).items);
    } else if (view.kind === "search") {
      // An empty query shows nothing — without even asking the API.
      setTasks(
        view.search.query.trim() === ""
          ? []
          : (await fetchSearchTasks(view.search.query, view.search)).items,
      );
    } else if (view.kind === "list") {
      setTasks((await fetchTasks(view.id)).items);
    } else if (view.kind === "folder") {
      // No endpoint spans multiple Lists — fetch each member List's Tasks
      // and flatten. Archived Lists stay out of the Folder view, same as
      // they stay out of the sidebar's Folder contents.
      const members = lists.filter((list) => list.folder_id === view.id && !list.is_archived);
      const pages = await Promise.all(members.map((list) => fetchTasks(list.id)));
      setTasks(pages.flatMap((page) => page.items));
    } else {
      setTasks((await fetchTasksByTag(view.id)).items);
    }
  }, [view, completedMode, lists, allFilters]);

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
    view?.kind === "list" ? (lists.find((list) => list.id === view.id) ?? null) : null;
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
  // Computed views can't be patched locally: membership depends on the query.
  const isComputedView = smartView !== null || completedMode || view?.kind === "search";
  // The completed view exists per List and for All (not Today / Next 7 Days).
  const hasCompletedView = selectedList !== null || smartView === "all";

  // One queue for the whole app: undo toasts for delete/complete (#155) and
  // create confirmations (#191) share it, so two stacks can never overlap and
  // a pending undo isn't lost when its view unmounts.
  const toasts = useUndoQueue();
  const clearToasts = toasts.clearAll;

  // No toast outlives the screen it was raised on: a stale "Added to Errands"
  // on a screen the user has already left is noise, and its "Show Task" would
  // undo their navigation. Anything still pending commits on the way out.
  const viewKey = keyOfView(view);
  useEffect(() => {
    clearToasts();
  }, [viewKey, clearToasts]);

  useEffect(() => {
    applyThemePreference(themePreference);
  }, [themePreference]);

  function chooseTheme(preference: ThemePreference): void {
    saveThemePreference(preference);
    setThemePreference(preference);
  }

  function toggleSidebar(): void {
    setSidebarCollapsed((current) => {
      saveSidebarCollapsed(!current);
      return !current;
    });
  }

  function switchView(next: View): void {
    setCompletedMode(false);
    setDrawerOpen(false);
    setView(next);
  }

  /** Keeps `view.mode` (and so /calendar/<mode> — see the sync effect above)
   * matching CalendarView's own internal mode state, without touching
   * completedMode/drawerOpen the way a full switchView would. */
  const handleCalendarModeChange = useCallback((mode: CalendarMode): void => {
    setView((current) => (current?.kind === "calendar" ? { kind: "calendar", mode } : current));
  }, []);

  /** Dismisses the Task detail sheet/panel — shared by its Close button, its
   * mobile backdrop, and its swipe-to-dismiss gesture (issue #170), so all
   * three ways out behave identically. Never touches `view`: the detail is
   * an overlay on top of whatever was already showing, so main's scroll
   * position is untouched by opening or closing it. */
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
  function announceCreated(created: Task): void {
    const listName = lists.find((list) => list.id === created.list_id)?.name;
    // With no name to give, say only what is certainly true rather than
    // naming a destination we can't identify.
    const message = listName === undefined ? "Task added" : `Added to ${listName}`;
    toasts.notify(
      message,
      isInCurrentView(created)
        ? undefined
        : {
            label: "Show Task",
            run: () => switchView({ kind: "list", id: created.list_id }),
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
  const habitsSelected = view?.kind === "habits";
  const standupSelected = view?.kind === "standup";
  const assistantSelected = view?.kind === "assistant";
  const focusSelected = view?.kind === "focus" || view?.kind === "focus-stats";
  const settingsSelected = view?.kind === "settings";
  const searchSelected = view?.kind === "search";
  const tasksSelected =
    !calendarSelected &&
    !habitsSelected &&
    !standupSelected &&
    !assistantSelected &&
    !focusSelected &&
    !settingsSelected &&
    !searchSelected;

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
    {
      key: "view-calendar",
      kind: "view" as const,
      label: "Calendar",
      run: () => switchView({ kind: "calendar", mode: "day" }),
    },
    {
      key: "view-habits",
      kind: "view" as const,
      label: "Habits",
      run: () => switchView({ kind: "habits" }),
    },
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
    {
      key: "view-focus",
      kind: "view" as const,
      label: "Focus",
      run: () => switchView({ kind: "focus" }),
    },
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
      run: () => switchView({ kind: "settings" }),
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
    <FocusRunProvider>
      <ShortcutsProvider>
        <ShellShortcuts onQuickAdd={() => setQuickAddOpen(true)} />
        {paletteOpen && (
          <CommandPalette items={paletteItems} onClose={() => setPaletteOpen(false)} />
        )}
        <div
          className={[
            "app",
            selectedTask === null ? "" : "with-detail",
            sidebarCollapsed ? "sidebar-collapsed" : "",
            drawerOpen ? "drawer-open" : "",
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
            habitsSelected={habitsSelected}
            standupSelected={standupSelected}
            standupEnabled={standupEnabled}
            assistantSelected={assistantSelected}
            assistantAvailable={assistantAvailable}
            focusSelected={focusSelected}
            settingsSelected={settingsSelected}
            searchSelected={searchSelected}
            onSelect={(listId) => switchView({ kind: "list", id: listId })}
            onSelectFolder={(folderId) => switchView({ kind: "folder", id: folderId })}
            onSelectTag={(tagId) => switchView({ kind: "tag", id: tagId })}
            onSelectSmart={(smart) => switchView({ kind: "smart", view: smart })}
            onSelectCalendar={() => switchView({ kind: "calendar", mode: "day" })}
            onSelectHabits={() => switchView({ kind: "habits" })}
            onSelectStandup={() => switchView({ kind: "standup" })}
            onSelectAssistant={() => switchView({ kind: "assistant" })}
            onSelectFocus={() => switchView({ kind: "focus" })}
            onSelectSettings={() => switchView({ kind: "settings" })}
            onQuickAdd={() => setQuickAddOpen(true)}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={toggleSidebar}
            onCloseDrawer={() => setDrawerOpen(false)}
            onLogout={onLogout}
            onSearch={(query) =>
              switchView({ kind: "search", search: { ...BLANK_SEARCH_STATE, query } })
            }
            onOpenSearch={() => switchView({ kind: "search", search: BLANK_SEARCH_STATE })}
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
          {drawerOpen && (
            <div className="drawer-scrim" aria-hidden="true" onClick={() => setDrawerOpen(false)} />
          )}
          <main>
            <div className="main-header">
              <button
                type="button"
                className="drawer-toggle"
                aria-label="Show navigation"
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen((current) => !current)}
              >
                <Icon name="menu" size={20} />
              </button>
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
              {hasCompletedView && (
                <button
                  type="button"
                  className="completed-toggle"
                  onClick={() => setCompletedMode((current) => !current)}
                >
                  {completedMode ? "Open tasks" : "Completed"}
                </button>
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
                <div className="view-controls">
                  <label>
                    Group by
                    <select
                      value={groupBy}
                      onChange={(event) => setGroupBy(event.target.value as GroupBy)}
                    >
                      <option value="section">Section</option>
                      <option value="date">Date</option>
                      <option value="priority">Priority</option>
                    </select>
                  </label>
                  <label>
                    Sort by
                    <select
                      value={sortBy}
                      onChange={(event) => setSortBy(event.target.value as SortBy)}
                    >
                      <option value="custom">Custom</option>
                      <option value="date">Date</option>
                      <option value="priority">Priority</option>
                      <option value="title">Title</option>
                    </select>
                  </label>
                </div>
              </>
            )}
            {smartView === "all" && !completedMode && (
              <div className="view-controls">
                <label>
                  List
                  <select
                    value={allFilters.listId ?? ""}
                    onChange={(event) =>
                      setAllFilters((current) => ({
                        ...current,
                        listId: event.target.value === "" ? null : Number(event.target.value),
                      }))
                    }
                  >
                    <option value="">Any</option>
                    {lists.map((list) => (
                      <option key={list.id} value={list.id}>
                        {list.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Tag
                  <select
                    value={allFilters.tagId ?? ""}
                    onChange={(event) =>
                      setAllFilters((current) => ({
                        ...current,
                        tagId: event.target.value === "" ? null : Number(event.target.value),
                      }))
                    }
                  >
                    <option value="">Any</option>
                    {tags.map((tag) => (
                      <option key={tag.id} value={tag.id}>
                        {tag.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Priority
                  <select
                    value={allFilters.priority ?? ""}
                    onChange={(event) =>
                      setAllFilters((current) => ({
                        ...current,
                        priority:
                          event.target.value === "" ? null : (event.target.value as Priority),
                      }))
                    }
                  >
                    <option value="">Any</option>
                    {(Object.keys(PRIORITY_LABELS) as Priority[]).map((priority) => (
                      <option key={priority} value={priority}>
                        {PRIORITY_LABELS[priority]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            {smartView === "all" && !completedMode && (
              <div className="view-controls">
                <label>
                  Group by
                  <select
                    value={groupBy}
                    onChange={(event) => setGroupBy(event.target.value as GroupBy)}
                  >
                    {/* "section" reruns as "None" here — All has no Sections
                      of its own, so grouping by one is really no grouping. */}
                    <option value="section">None</option>
                    <option value="date">Date</option>
                    <option value="priority">Priority</option>
                    <option value="list">List</option>
                  </select>
                </label>
                <label>
                  Sort by
                  <select
                    value={sortBy}
                    onChange={(event) => setSortBy(event.target.value as SortBy)}
                  >
                    <option value="custom">Custom</option>
                    <option value="date">Date</option>
                    <option value="priority">Priority</option>
                    <option value="title">Title</option>
                  </select>
                </label>
              </div>
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
                      onChange={(event) => setFolderSortBy(event.target.value as FolderSortBy)}
                    >
                      <option value="date">Date</option>
                      <option value="priority">Priority</option>
                      <option value="title">Title</option>
                    </select>
                  </label>
                </div>
              </>
            )}
            {view?.kind === "settings" ? (
              <SettingsView
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
              />
            ) : view?.kind === "habits" ? (
              <HabitsView />
            ) : view?.kind === "standup" ? (
              <StandupView />
            ) : view?.kind === "assistant" ? (
              <AssistantView />
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
                lists={lists}
                tags={tags}
                state={view.search}
                onStateChange={(search) => switchView({ kind: "search", search })}
                onChanged={changeTasksAndRecompute}
                onSelect={setSelectedTaskId}
              />
            ) : selectedFolder !== null ? (
              <FolderView
                folder={selectedFolder}
                lists={folderMembers}
                tasks={tasks}
                sortBy={folderSortBy}
                onChanged={changeTasks}
                onSelect={setSelectedTaskId}
                onSelectList={(listId) => switchView({ kind: "list", id: listId })}
                onStartFocus={(task) => switchView({ kind: "focus", task })}
              />
            ) : completedMode ? (
              <CompletedView
                tasks={tasks}
                occurrences={occurrences}
                onChanged={changeTasksAndRecompute}
                onSelect={setSelectedTaskId}
              />
            ) : selectedList !== null && selectedList.view_mode === "kanban" ? (
              <KanbanView
                tasks={tasks}
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
                tasks={tasks}
                sections={sections}
                listId={smartView !== null ? null : (selectedList?.id ?? null)}
                lists={lists}
                tags={tags}
                viewKey={viewKey}
                groupBy={groupBy}
                sortBy={sortBy}
                onChanged={smartView !== null ? changeTasksAndRecompute : changeTasks}
                onSelect={setSelectedTaskId}
                onSectionsChanged={setSections}
                onStartFocus={(task) => switchView({ kind: "focus", task })}
                toasts={toasts}
              />
            )}
            {/* The shortcut hint strip lives at the foot of the task list;
              it reads the live registry, so later slices that register
              shortcuts appear here automatically (issue #192). */}
            <ShortcutHints />
          </main>
          <MobileTabBar
            tasksSelected={tasksSelected}
            calendarSelected={calendarSelected}
            habitsSelected={habitsSelected}
            focusSelected={focusSelected}
            onSelectTasks={() => switchView({ kind: "smart", view: "today" })}
            onSelectCalendar={() => switchView({ kind: "calendar", mode: "day" })}
            onSelectHabits={() => switchView({ kind: "habits" })}
            onSelectFocus={() => switchView({ kind: "focus" })}
          />
          {selectedTask !== null && (
            <div className="task-detail-backdrop" aria-hidden="true" onClick={closeTaskDetail} />
          )}
          {selectedTask !== null && (
            <TaskDetail
              task={selectedTask}
              allTags={tags}
              listName={selectedTaskListName}
              onTaskChanged={applyTaskChange}
              onClose={closeTaskDetail}
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
        </div>
      </ShortcutsProvider>
    </FocusRunProvider>
  );
}

/** Registers the shell's own shortcuts against the layer (issue #192). Kept a
 * child of App so it sits inside ShortcutsProvider; the scope guard on this
 * slice is deliberate — the command palette, row navigation and per-Task
 * verbs are separate slices that register against this layer rather than
 * adding their own listeners. */
function ShellShortcuts({ onQuickAdd }: { onQuickAdd: () => void }): null {
  useRegisterShortcut({ key: "n", label: "N", description: "Quick add", run: onQuickAdd });
  useRegisterShortcut({
    key: "/",
    label: "/",
    description: "Search",
    run: () => {
      const field = document.querySelector<HTMLInputElement>(".sidebar-search input");
      field?.focus();
      field?.select();
    },
  });
  return null;
}
