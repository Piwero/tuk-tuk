import type { CalendarMode } from "./calendar";
import type { SmartView } from "./api";

/** URL routing for the app's static, URL-addressable views (issue #143).
 * List/Tag/Folder views stay in-memory only — they're not represented here
 * and never get a path. Smart views (Today/Next 7 Days/All) do get one. */
export type StaticViewKind =
  "standup" | "focus" | "focus-stats" | "calendar" | "habits" | "search" | "settings" | "smart";

const STATIC_VIEW_PATHS: Record<StaticViewKind, string> = {
  calendar: "/calendar/day",
  habits: "/habits",
  standup: "/standup",
  focus: "/focus",
  "focus-stats": "/focus/stats",
  search: "/search",
  settings: "/settings",
  smart: "/all",
};

/** The Calendar's per-mode URLs (issue: individual URIs for Month/Week/Day)
 * — `/calendar` alone (no mode segment) is kept working as an alias for Day,
 * so old bookmarks/links to it still resolve. */
const CALENDAR_MODE_PATHS: Record<CalendarMode, string> = {
  month: "/calendar/month",
  week: "/calendar/week",
  day: "/calendar/day",
};

/** The Smart Lists' per-view URLs. `/` (the app's root) is kept working as
 * an alias for All, so it stays the view a bare landing resolves to. */
const SMART_VIEW_PATHS: Record<SmartView, string> = {
  today: "/today",
  next7: "/next-7-days",
  all: "/all",
};

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
 * defaulting to All for the bare `/` alias. Returns null for any other
 * path. */
export function smartViewForPath(pathname: string): SmartView | null {
  if (pathname === "/") {
    return "all";
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

export function staticViewKindForPath(pathname: string): StaticViewKind | null {
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
