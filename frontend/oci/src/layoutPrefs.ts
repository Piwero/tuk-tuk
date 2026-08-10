/** Persistence for layout choices the user makes about the shell.
 *
 * These are preferences, not data: they belong to this browser, so they live
 * in localStorage rather than the API. Reads never throw — a browser with
 * storage disabled just falls back to the default layout.
 */

const COLLAPSED_KEY = "tuktuk.sidebar.collapsed";

export function loadSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, String(collapsed));
  } catch {
    // Storage full or unavailable: the sidebar still collapses, the choice
    // just won't survive a reload.
  }
}

// Which Folders the user has collapsed — a set of ids, stored as a JSON
// array. Absent (or unparseable) means every Folder starts expanded, so
// existing users see no change on upgrade.
const FOLDER_COLLAPSED_KEY = "tuktuk.sidebar.foldersCollapsed";

export function loadCollapsedFolderIds(): Set<number> {
  try {
    const raw = localStorage.getItem(FOLDER_COLLAPSED_KEY);
    if (raw === null) {
      return new Set();
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((value): value is number => typeof value === "number"))
      : new Set();
  } catch {
    return new Set();
  }
}

export function saveCollapsedFolderIds(ids: Set<number>): void {
  try {
    localStorage.setItem(FOLDER_COLLAPSED_KEY, JSON.stringify([...ids]));
  } catch {
    // Storage full or unavailable: collapsing still works this session, the
    // choice just won't survive a reload.
  }
}
