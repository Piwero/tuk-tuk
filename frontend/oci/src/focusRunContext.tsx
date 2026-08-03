/** The live Pomo/Stopwatch run, shared outside the Focus screen.
 *
 * The run itself is still just timestamps (see focusRun.ts), but the nav bar
 * needs to show it too — running or just finished — so the ticking clock and
 * the finish/pause/resume actions live here instead of inside FocusView.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { createFocusSession, type FocusMode } from "./api";
import { linkFields, type FocusLink } from "./focusLink";
import { clearStoredRun, loadStoredRun, saveStoredRun } from "./focusRun";

export interface RunningSession {
  mode: FocusMode;
  /** The Pomo length this run counts down from (frozen at start). */
  pomoMs: number;
  startedAtMs: number;
  /** Completed pause time so far, excluding a pause still in progress. */
  pausedMs: number;
  pauseStartedAtMs: number | null;
  link: FocusLink;
}

interface FocusRunContextValue {
  running: RunningSession | null;
  /** A pomo (or stopwatch) finished since the last dismissal — the nav badge
   * keeps announcing it until the user looks or starts another run. */
  justFinished: boolean;
  elapsedMs: number;
  remainingMs: number;
  start: (config: { mode: FocusMode; pomoMs: number; link: FocusLink }) => void;
  pause: () => void;
  resume: () => void;
  finish: () => Promise<void>;
  dismissFinished: () => void;
}

const FocusRunContext = createContext<FocusRunContextValue | null>(null);

export function FocusRunProvider({ children }: { children: ReactNode }): JSX.Element {
  const [restored] = useState(loadStoredRun);
  const [running, setRunning] = useState<RunningSession | null>(
    restored === null ? null : { ...restored },
  );
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [justFinished, setJustFinished] = useState(false);
  const finishing = useRef(false);

  // The run survives every mount: every change is written through to
  // storage, and finishing (or discarding) clears it.
  useEffect(() => {
    if (running === null) {
      clearStoredRun();
    } else {
      saveStoredRun(running);
    }
  }, [running]);

  // The clock: one tick a second while a timer runs.
  useEffect(() => {
    if (running === null) {
      return;
    }
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  // Background tabs throttle intervals; returning re-syncs the clock at once.
  useEffect(() => {
    const sync = (): void => setNowMs(Date.now());
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  const elapsedMs =
    running === null
      ? 0
      : (running.pauseStartedAtMs ?? nowMs) - running.startedAtMs - running.pausedMs;
  const remainingMs = running === null ? 0 : running.pomoMs - elapsedMs;

  const finish = useCallback(async (): Promise<void> => {
    if (running === null || finishing.current) {
      return;
    }
    finishing.current = true;
    // A Pomo that ran out while nobody was watching (the view unmounted, the
    // tab asleep) ends at its true expiry, not at whenever we noticed.
    const expiryMs = running.startedAtMs + running.pausedMs + running.pomoMs;
    const endMs =
      running.mode === "pomo" && running.pauseStartedAtMs === null
        ? Math.min(Date.now(), expiryMs)
        : Date.now();
    const pausedTotalMs =
      running.pausedMs + (running.pauseStartedAtMs === null ? 0 : endMs - running.pauseStartedAtMs);
    try {
      await createFocusSession({
        mode: running.mode,
        ...linkFields(running.link),
        started_at: new Date(running.startedAtMs).toISOString(),
        ended_at: new Date(endMs).toISOString(),
        pause_seconds: Math.round(pausedTotalMs / 1000),
      });
      setRunning(null);
      setJustFinished(true);
    } finally {
      // A failed save must not wedge the timer: the guard lifts so the next
      // tick (or tap) retries the finish.
      finishing.current = false;
    }
  }, [running]);

  // A Pomo finishes itself when the countdown reaches zero.
  useEffect(() => {
    if (running !== null && running.mode === "pomo" && remainingMs <= 0) {
      void finish();
    }
  }, [running, remainingMs, finish]);

  const start = useCallback(
    (config: { mode: FocusMode; pomoMs: number; link: FocusLink }): void => {
      finishing.current = false;
      setJustFinished(false);
      setRunning({
        mode: config.mode,
        pomoMs: config.pomoMs,
        startedAtMs: Date.now(),
        pausedMs: 0,
        pauseStartedAtMs: null,
        link: config.link,
      });
    },
    [],
  );

  const pause = useCallback((): void => {
    setRunning((current) =>
      current !== null && current.pauseStartedAtMs === null
        ? { ...current, pauseStartedAtMs: Date.now() }
        : current,
    );
  }, []);

  const resume = useCallback((): void => {
    setRunning((current) =>
      current !== null && current.pauseStartedAtMs !== null
        ? {
            ...current,
            pausedMs: current.pausedMs + (Date.now() - current.pauseStartedAtMs),
            pauseStartedAtMs: null,
          }
        : current,
    );
  }, []);

  const dismissFinished = useCallback((): void => setJustFinished(false), []);

  return (
    <FocusRunContext.Provider
      value={{
        running,
        justFinished,
        elapsedMs,
        remainingMs,
        start,
        pause,
        resume,
        finish,
        dismissFinished,
      }}
    >
      {children}
    </FocusRunContext.Provider>
  );
}

export function useFocusRun(): FocusRunContextValue {
  const ctx = useContext(FocusRunContext);
  if (ctx === null) {
    throw new Error("useFocusRun must be used within a FocusRunProvider");
  }
  return ctx;
}
