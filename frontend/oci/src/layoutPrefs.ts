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

// Appearance (issue #193): Light / Dark / System. Like the collapsed state
// above, the choice belongs to this browser, not the account — it never
// touches the API. "system" (the default, and the fallback whenever storage
// is unavailable or the stored value is unrecognised) defers to the OS.
export type ThemePreference = "light" | "dark" | "system";

const THEME_KEY = "tuktuk.theme";
const THEME_VALUES: readonly ThemePreference[] = ["light", "dark", "system"];

export function loadThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return THEME_VALUES.includes(raw as ThemePreference) ? (raw as ThemePreference) : "system";
  } catch {
    return "system";
  }
}

export function saveThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_KEY, preference);
  } catch {
    // Storage full or unavailable: the theme still applies this session, the
    // choice just won't survive a reload.
  }
}

function prefersDark(): MediaQueryList | null {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;
  } catch {
    return null;
  }
}

/** Collapses the Light / Dark / System choice to the concrete theme showing
 * right now — "system" defers to the OS. Used by the nav-bar toggle, which
 * flips to the opposite of whatever is currently on screen. */
export function resolveThemePreference(preference: ThemePreference): "light" | "dark" {
  if (preference !== "system") {
    return preference;
  }
  return prefersDark()?.matches ? "dark" : "light";
}

let systemListener: (() => void) | null = null;
let systemQuery: MediaQueryList | null = null;

/** Resolves the Light / Dark / System choice to a concrete `data-theme` on
 * <html>, which is the single switch every dark alias in tokens.css keys off.
 * No component ever reads this — surfaces follow because they reference the
 * alias, not the ramp. When the choice is "system" it also subscribes to the
 * OS setting so a live flip re-resolves without a reload; any other choice
 * tears that subscription down. Never throws: a browser without matchMedia
 * simply renders light. */
export function applyThemePreference(preference: ThemePreference): void {
  const query = prefersDark();

  if (systemListener && systemQuery) {
    systemQuery.removeEventListener("change", systemListener);
  }
  systemListener = null;
  systemQuery = null;

  const resolved = preference === "system" ? (query?.matches ? "dark" : "light") : preference;

  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", resolved);
  }

  if (preference === "system" && query) {
    systemQuery = query;
    systemListener = () => {
      document.documentElement.setAttribute("data-theme", query.matches ? "dark" : "light");
    };
    query.addEventListener("change", systemListener);
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

// Whether the user has ever drag-reordered a Task (issue #260). The
// "Custom" sort's underlying order (sort_order) always exists — new Tasks
// append to it — so a first-time user sees a sequence that looks arbitrary
// under a label that sounds deliberate. This flag lets the Sort by control
// say "not yet arranged" until a drag actually happens, then "your order"
// after. Global rather than per-List: once the user has dragged anywhere,
// the concept is no longer a mystery.
const REORDERED_KEY = "tuktuk.tasks.reordered";

export function hasReorderedTasks(): boolean {
  try {
    return localStorage.getItem(REORDERED_KEY) === "true";
  } catch {
    return false;
  }
}

export function markTasksReordered(): void {
  try {
    localStorage.setItem(REORDERED_KEY, "true");
  } catch {
    // Storage full or unavailable: the hint just won't update this session.
  }
}
