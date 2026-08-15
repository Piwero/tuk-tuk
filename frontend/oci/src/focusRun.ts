/** Persistence for the in-progress Focus run.
 *
 * The run is pure timestamps (started-at, paused-so-far), so storing it lets
 * the clock survive anything that unmounts the Focus screen — switching
 * views, closing the browser tab, a reload — and reads correctly on return:
 * elapsed time is always recomputed from Date.now(), never counted in ticks.
 */

import { type FocusMode } from "./api";
import { type FocusLink } from "./focusLink";

/** A run is either real focus time ("focus") or a rest period between Pomos
 * ("break") — a break never becomes a Focus Session, however it ends. */
export type FocusPhase = "focus" | "break";

export interface StoredRun {
  mode: FocusMode;
  phase: FocusPhase;
  /** The length this run counts down from (frozen at start): the Pomo or
   * break length, matching `phase`. */
  pomoMs: number;
  /** The configured break / long-break lengths, carried on a focus run so
   * they're available to offer the next break once it finishes. */
  breakMs: number;
  longBreakMs: number;
  startedAtMs: number;
  /** Completed pause time so far, excluding a pause still in progress. */
  pausedMs: number;
  pauseStartedAtMs: number | null;
  /** The Task/Habit the run was started against. */
  link: FocusLink;
}

const KEY = "tuktuk.focus.run";

export function loadStoredRun(): StoredRun | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) {
      return null;
    }
    const run = JSON.parse(raw) as StoredRun;
    const valid =
      (run.mode === "pomo" || run.mode === "stopwatch") &&
      typeof run.pomoMs === "number" &&
      typeof run.startedAtMs === "number" &&
      typeof run.pausedMs === "number" &&
      (run.pauseStartedAtMs === null || typeof run.pauseStartedAtMs === "number") &&
      typeof run.link === "string";
    if (!valid) {
      return null;
    }
    // Back-compat: a run stored before break support has none of these —
    // treat it as an ordinary focus run with no break configured.
    return {
      ...run,
      phase: run.phase === "break" ? "break" : "focus",
      breakMs: typeof run.breakMs === "number" ? run.breakMs : 0,
      longBreakMs: typeof run.longBreakMs === "number" ? run.longBreakMs : 0,
    };
  } catch {
    return null;
  }
}

export function saveStoredRun(run: StoredRun): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(run));
  } catch {
    // Storage full or unavailable: the run still works, it just won't survive
    // an unmount.
  }
}

export function clearStoredRun(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Ignore: nothing to clear if storage is unavailable.
  }
}
