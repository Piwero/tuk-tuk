/** URL routing for the app's static, URL-addressable views (issue #143).
 * List/Tag/Folder/Smart views stay in-memory only — they're not represented
 * here and never get a path. */
export type StaticViewKind = "standup" | "focus" | "calendar" | "habits" | "search" | "settings";

const STATIC_VIEW_PATHS: Record<StaticViewKind, string> = {
  calendar: "/calendar",
  habits: "/habits",
  standup: "/standup",
  focus: "/focus",
  search: "/search",
  settings: "/settings",
};

export function pathForStaticView(kind: StaticViewKind): string {
  return STATIC_VIEW_PATHS[kind];
}

export function staticViewKindForPath(pathname: string): StaticViewKind | null {
  const match = (Object.keys(STATIC_VIEW_PATHS) as StaticViewKind[]).find(
    (kind) => STATIC_VIEW_PATHS[kind] === pathname,
  );
  return match ?? null;
}
