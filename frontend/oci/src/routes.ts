import type { CalendarMode } from "./calendar";
import type { SmartView } from "./api";

/** URL routing for static views and user-created containers. */
export type StaticViewKind =
  | "standup"
  | "assistant"
  | "focus"
  | "focus-stats"
  | "calendar"
  | "goals"
  | "habits"
  | "search"
  | "settings"
  | "smart";

const STATIC_VIEW_PATHS: Record<StaticViewKind, string> = {
  calendar: "/calendar/day",
  goals: "/goals",
  habits: "/habits",
  standup: "/standup",
  assistant: "/assistant",
  focus: "/focus",
  "focus-stats": "/focus/stats",
  search: "/search",
  settings: "/settings/account",
  smart: "/all",
};

/** Settings' tabs (#474), each at its own URL. `/settings` alone is an alias
 * for My account, so old bookmarks/links to it still resolve. Users is for
 * Admins only; SettingsView resolves it to My account for anyone else. */
export type SettingsTab = "account" | "users";

const SETTINGS_TAB_PATHS: Record<SettingsTab, string> = {
  account: "/settings/account",
  users: "/settings/users",
};

/** The Calendar's per-mode URLs (issue: individual URIs for Month/Week/Day)
 * — `/calendar` alone (no mode segment) is kept working as an alias for Day,
 * so old bookmarks/links to it still resolve. */
const CALENDAR_MODE_PATHS: Record<CalendarMode, string> = {
  month: "/calendar/month",
  week: "/calendar/week",
  day: "/calendar/day",
};

/** The Smart Lists' per-view URLs. `/` (the app's root) is an alias for
 * Today, so a bare landing opens the user's day (#428). */
const SMART_VIEW_PATHS: Record<SmartView, string> = {
  today: "/today",
  next7: "/next-7-days",
  all: "/all",
};

export type ContainerRoute =
  | { kind: "list"; id: number; mode?: "list" | "kanban" | "completed" }
  | { kind: "tag" | "folder"; id: number };

export function pathForContainer(view: ContainerRoute): string {
  const suffix = view.kind === "list" && view.mode && view.mode !== "list" ? `/${view.mode}` : "";
  return `/${view.kind}s/${view.id}${suffix}`;
}

export function containerForPath(pathname: string): ContainerRoute | null {
  const match = /^\/(lists|tags|folders)\/([1-9]\d*)(?:\/(kanban|completed))?$/.exec(pathname);
  if (!match || !Number.isSafeInteger(Number(match[2]))) return null;
  const id = Number(match[2]);
  if (match[1] === "lists")
    return { kind: "list", id, mode: (match[3] ?? "list") as "list" | "kanban" | "completed" };
  if (match[3]) return null;
  return { kind: match[1] === "tags" ? "tag" : "folder", id };
}

export function pathForStaticView(kind: StaticViewKind): string {
  return STATIC_VIEW_PATHS[kind];
}

export function pathForCalendarMode(mode: CalendarMode): string {
  return CALENDAR_MODE_PATHS[mode];
}

export function pathForSmartView(view: SmartView): string {
  return SMART_VIEW_PATHS[view];
}

/** Reads the Smart view out of a `/today`, `/next-7-days`, or `/all` path,
 * defaulting to Today for the bare `/` alias. Returns null for any other
 * path. */
export function smartViewForPath(pathname: string): SmartView | null {
  if (pathname === "/") {
    return "today";
  }
  const match = (Object.keys(SMART_VIEW_PATHS) as SmartView[]).find(
    (view) => SMART_VIEW_PATHS[view] === pathname,
  );
  return match ?? null;
}

/** Reads the Calendar mode out of a `/calendar...` path, defaulting to Day
 * for the bare `/calendar` alias. Returns null for a non-Calendar path. */
export function calendarModeForPath(pathname: string): CalendarMode | null {
  if (pathname === "/calendar") {
    return "day";
  }
  const match = (Object.keys(CALENDAR_MODE_PATHS) as CalendarMode[]).find(
    (mode) => CALENDAR_MODE_PATHS[mode] === pathname,
  );
  return match ?? null;
}

export function pathForSettingsTab(tab: SettingsTab): string {
  return SETTINGS_TAB_PATHS[tab];
}

/** Reads the Settings tab out of a `/settings...` path, defaulting to My
 * account for the bare `/settings` alias. Returns null for any other path. */
export function settingsTabForPath(pathname: string): SettingsTab | null {
  if (pathname === "/settings") {
    return "account";
  }
  const match = (Object.keys(SETTINGS_TAB_PATHS) as SettingsTab[]).find(
    (tab) => SETTINGS_TAB_PATHS[tab] === pathname,
  );
  return match ?? null;
}

export function staticViewKindForPath(pathname: string): StaticViewKind | null {
  if (settingsTabForPath(pathname) !== null) {
    return "settings";
  }
  if (calendarModeForPath(pathname) !== null) {
    return "calendar";
  }
  if (smartViewForPath(pathname) !== null) {
    return "smart";
  }
  const match = (Object.keys(STATIC_VIEW_PATHS) as StaticViewKind[]).find(
    (kind) => STATIC_VIEW_PATHS[kind] === pathname,
  );
  return match ?? null;
}
