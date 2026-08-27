import { createContext, useContext, useEffect, useRef } from "react";

/** One global keyboard shortcut. `key` is matched case-insensitively against
 * `KeyboardEvent.key`; `label` is how the chord is drawn in the hint strip
 * and `description` names what it does there. */
export interface ShortcutSpec {
  key: string;
  label: string;
  description: string;
  run: () => void;
}

export interface ShortcutRegistry {
  /** Adds a shortcut and returns its remover. Registration order is the
   * order the hint strip lists them in. */
  register: (spec: ShortcutSpec) => () => void;
  shortcuts: ShortcutSpec[];
}

export const ShortcutContext = createContext<ShortcutRegistry | null>(null);

/** True when a keydown must be left alone: another handler already claimed it,
 * it carries a browser editing/navigation chord (Ctrl/Cmd/Alt), the target is
 * a text field, or focus sits inside an open dialog. Keeps the layer from
 * swallowing the browser's own keys or firing over a form the user is typing
 * into. */
export function isTypingContext(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
    return true;
  }
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
    return true;
  }
  return target.closest('[role="dialog"], [aria-modal="true"]') !== null;
}

/** Registers one shortcut for the lifetime of the calling component. The
 * handler is always called fresh, so callers need not memoize `run`. */
export function useRegisterShortcut(spec: ShortcutSpec): void {
  const registry = useContext(ShortcutContext);
  if (registry === null) {
    throw new Error("useRegisterShortcut must be used within a ShortcutsProvider");
  }
  const runRef = useRef(spec.run);
  runRef.current = spec.run;
  const { register } = registry;
  const { key, label, description } = spec;
  useEffect(
    () => register({ key, label, description, run: () => runRef.current() }),
    [register, key, label, description],
  );
}

/** The shortcuts currently registered, in registration order — for the hint
 * strip. */
export function useShortcuts(): ShortcutSpec[] {
  const registry = useContext(ShortcutContext);
  if (registry === null) {
    throw new Error("useShortcuts must be used within a ShortcutsProvider");
  }
  return registry.shortcuts;
}
