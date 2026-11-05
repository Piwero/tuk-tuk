export const DEFAULT_OVERLAY_SHORTCUT = "Alt+Shift+V";
const STORAGE_KEY = "tuktuk.voice.overlayShortcut";
let temporaryShortcut: string | undefined;

export interface OverlayShortcut {
  key: string;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
}

export function parseOverlayShortcut(value: string): OverlayShortcut | null {
  const parts = value.split("+");
  const key = parts.pop()?.trim().toUpperCase();
  const modifiers = new Set(parts.map((part) => part.trim().toLowerCase()));
  if (
    !key ||
    !/^[A-Z0-9]$/.test(key) ||
    [...modifiers].some((part) => !["alt", "ctrl", "meta", "shift"].includes(part)) ||
    new Set(parts.map((part) => part.trim().toLowerCase())).size !== parts.length ||
    !["alt", "ctrl", "meta"].some((modifier) => modifiers.has(modifier))
  ) {
    return null;
  }
  const chord = {
    key,
    alt: modifiers.has("alt"),
    ctrl: modifiers.has("ctrl"),
    meta: modifiers.has("meta"),
    shift: modifiers.has("shift"),
  };
  const appConflict =
    (!chord.alt && !chord.shift && (chord.key === "N" || chord.key === "/")) ||
    ((chord.ctrl || chord.meta) && ["T", "W", "N"].includes(chord.key));
  if (appConflict) return null;
  return chord;
}

export function formatOverlayShortcut(shortcut: OverlayShortcut): string {
  return [
    shortcut.ctrl && "Ctrl",
    shortcut.alt && "Alt",
    shortcut.shift && "Shift",
    shortcut.meta && "Meta",
    shortcut.key,
  ]
    .filter(Boolean)
    .join("+");
}

export function loadOverlayShortcut(): string {
  if (temporaryShortcut !== undefined) return temporaryShortcut;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? parseOverlayShortcut(stored) : null;
    return parsed ? formatOverlayShortcut(parsed) : DEFAULT_OVERLAY_SHORTCUT;
  } catch {
    return DEFAULT_OVERLAY_SHORTCUT;
  }
}

export function saveOverlayShortcut(value: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, value);
    temporaryShortcut = undefined;
  } catch {
    const parsed = parseOverlayShortcut(value);
    temporaryShortcut = parsed ? formatOverlayShortcut(parsed) : DEFAULT_OVERLAY_SHORTCUT;
  }
}
