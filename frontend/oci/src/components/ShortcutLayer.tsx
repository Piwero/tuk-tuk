import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  isTypingContext,
  ShortcutContext,
  useShortcuts,
  type ShortcutRegistry,
  type ShortcutSpec,
} from "../shortcuts";

/** Owns the app's single `keydown` listener and the live list of registered
 * shortcuts. Every shortcut-driven feature registers here (via
 * `useRegisterShortcut`) rather than adding its own listener, so suppression
 * rules and the hint strip stay in one place. */
export function ShortcutsProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [shortcuts, setShortcuts] = useState<ShortcutSpec[]>([]);
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  const register = useCallback((spec: ShortcutSpec): (() => void) => {
    setShortcuts((current) => [...current, spec]);
    return () => setShortcuts((current) => current.filter((entry) => entry !== spec));
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (isTypingContext(event)) {
        return;
      }
      const match = shortcutsRef.current.find(
        (entry) => entry.key.toLowerCase() === event.key.toLowerCase(),
      );
      if (match === undefined) {
        return;
      }
      event.preventDefault();
      match.run();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const value = useMemo<ShortcutRegistry>(() => ({ register, shortcuts }), [register, shortcuts]);
  return <ShortcutContext.Provider value={value}>{children}</ShortcutContext.Provider>;
}

/** The strip along the foot of the task list that advertises every registered
 * shortcut. Renders nothing when none are registered, and is hidden under a
 * coarse pointer (see index.css) where there is no keyboard to advertise. */
export function ShortcutHints(): JSX.Element | null {
  const shortcuts = useShortcuts();
  if (shortcuts.length === 0) {
    return null;
  }
  return (
    <div className="shortcut-hints" aria-label="Keyboard shortcuts">
      {shortcuts.map((shortcut) => (
        <span className="shortcut-hint" key={shortcut.key}>
          <kbd>{shortcut.label}</kbd> {shortcut.description}
        </span>
      ))}
    </div>
  );
}
