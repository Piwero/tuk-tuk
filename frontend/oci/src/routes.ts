import type { CalendarMode } from "./calendar";

/** URL routing for the app's static, URL-addressable views (issue #143).
 * List/Tag/Folder/Smart views stay in-memory only — they're not represented
 * here and never get a path. */
export type StaticViewKind =
  "standup" | "focus" | "focus-stats" | "calendar" | "habits" | "search" | "settings";

const STATIC_VIEW_PATHS: Record<StaticViewKind, string> = {
  calendar: "/calendar/day",
  habits: "/habits",
  standup: "/standup",
  focus: "/focus",
  "focus-stats": "/focus/stats",
  search: "/search",
  settings: "/settings",
};

/** The Calendar's per-mode URLs (issue: individual URIs for Month/Week/Day)
 * — `/calendar` alone (no mode segment) is kept working as an alias for Day,
 * so old bookmarks/links to it still resolve. */
const CALENDAR_MODE_PATHS: Record<CalendarMode, string> = {
  month: "/calendar/month",
  week: "/calendar/week",
  day: "/calendar/day",
};

export function pathForStaticView(kind: StaticViewKind): string {
  return STATIC_VIEW_PATHS[kind];
}

export function pathForCalendarMode(mode: CalendarMode): string {
  return CALENDAR_MODE_PATHS[mode];
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
  const match = (Object.keys(STATIC_VIEW_PATHS) as StaticViewKind[]).find(
    (kind) => STATIC_VIEW_PATHS[kind] === pathname,
  );
  return match ?? null;
}
