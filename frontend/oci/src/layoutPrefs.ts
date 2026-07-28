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
