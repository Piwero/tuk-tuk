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
import { clearStoredRun, loadStoredRun, saveStoredRun, type FocusPhase } from "./focusRun";
import { playFocusRunEndSound } from "./notificationSound";

const DEFAULT_BREAK_MS = 5 * 60_000;
const DEFAULT_LONG_BREAK_MS = 15 * 60_000;

export interface RunningSession {
  mode: FocusMode;
  phase: FocusPhase;
  /** The length this run counts down from (frozen at start): the Pomo or
   * break length, matching `phase`. */
  pomoMs: number;
  /** The configured break / long-break lengths — carried on a focus run so
   * they're available once it finishes; unused on a break run. */
  breakMs: number;
  longBreakMs: number;
  startedAtMs: number;
  /** Completed pause time so far, excluding a pause still in progress. */
  pausedMs: number;
  pauseStartedAtMs: number | null;
  link: FocusLink;
}

/** Offered right after a Pomo (not a break) finishes: which break to take
 * next, decided by a 4-Pomo cycle (the 4th offers the long break). */
export interface PendingBreak {
  shortMs: number;
  longMs: number;
  long: boolean;
}

interface FocusRunContextValue {
  running: RunningSession | null;
  /** A run finished since the last dismissal — the nav badge keeps
   * announcing it until the user looks or starts another run. */
  justFinished: boolean;
  /** Set right after a Pomo (not a break) finishes, offering the next break;
   * cleared by starting or skipping it, or by starting a fresh run. */
  pendingBreak: PendingBreak | null;
  elapsedMs: number;
  remainingMs: number;
  start: (config: {
    mode: FocusMode;
    pomoMs: number;
    /** Break / long-break lengths to offer once this Pomo finishes — absent
     * for a caller that doesn't offer breaks (e.g. a task row's quick-start
     * menu), which falls back to the default 5 / 15 minutes. */
    breakMs?: number;
    longBreakMs?: number;
    link: FocusLink;
  }) => void;
  pause: () => void;
  resume: () => void;
  /** Ends the run honestly at its true stopping point and records it as a
   * Focus Session — never called for a break, which is never recorded. */
  finish: () => Promise<void>;
  /** Discards the run outright: nothing is recorded, however far it got.
   * Also how a break ends (a break was never going to be recorded either). */
  cancel: () => void;
  /** Starts whichever break `pendingBreak` currently offers. */
  startBreak: () => void;
  /** Declines the offered break, going straight back to idle. */
  skipBreak: () => void;
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
  const [pendingBreak, setPendingBreak] = useState<PendingBreak | null>(null);
  // How many Pomos have finished this streak — a 4th offers the long break.
  // Not persisted: a reload resets the streak, which is a fair trade for not
  // adding another moving part to the stored run.
  const pomoStreak = useRef(0);
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
    // A run that ran out while nobody was watching (the view unmounted, the
    // tab asleep) ends at its true expiry, not at whenever we noticed.
    const expiryMs = running.startedAtMs + running.pausedMs + running.pomoMs;
    const endMs =
      running.mode === "pomo" && running.pauseStartedAtMs === null
        ? Math.min(Date.now(), expiryMs)
        : Date.now();
    const pausedTotalMs =
      running.pausedMs + (running.pauseStartedAtMs === null ? 0 : endMs - running.pauseStartedAtMs);
    try {
      if (running.phase === "break") {
        // A break is never focus time — it never becomes a Focus Session.
        setRunning(null);
        setJustFinished(true);
        playFocusRunEndSound(running.phase);
        return;
      }
      await createFocusSession({
        mode: running.mode,
        ...linkFields(running.link),
        started_at: new Date(running.startedAtMs).toISOString(),
        ended_at: new Date(endMs).toISOString(),
        pause_seconds: Math.round(pausedTotalMs / 1000),
      });
      setRunning(null);
      setJustFinished(true);
      playFocusRunEndSound(running.phase);
      if (running.mode === "pomo") {
        pomoStreak.current += 1;
        setPendingBreak({
          shortMs: running.breakMs,
          longMs: running.longBreakMs,
          long: pomoStreak.current % 4 === 0,
        });
      }
    } finally {
      // A failed save must not wedge the timer: the guard lifts so the next
      // tick (or tap) retries the finish.
      finishing.current = false;
    }
  }, [running]);

  /** Discards the run outright — never recorded, whatever phase it was in. */
  const cancel = useCallback((): void => {
    setRunning(null);
  }, []);

  // A run finishes itself when the countdown reaches zero (Pomo or break —
  // both are fixed-length countdowns; a Stopwatch only ends via Finish).
  useEffect(() => {
    if (running !== null && running.mode === "pomo" && remainingMs <= 0) {
      void finish();
    }
  }, [running, remainingMs, finish]);

  const start = useCallback(
    (config: {
      mode: FocusMode;
      pomoMs: number;
      breakMs?: number;
      longBreakMs?: number;
      link: FocusLink;
    }): void => {
      finishing.current = false;
      setJustFinished(false);
      setPendingBreak(null);
      setRunning({
        mode: config.mode,
        phase: "focus",
        pomoMs: config.pomoMs,
        breakMs: config.breakMs ?? DEFAULT_BREAK_MS,
        longBreakMs: config.longBreakMs ?? DEFAULT_LONG_BREAK_MS,
        startedAtMs: Date.now(),
        pausedMs: 0,
        pauseStartedAtMs: null,
        link: config.link,
      });
    },
    [],
  );

  const startBreak = useCallback((): void => {
    if (pendingBreak === null) {
      return;
    }
    finishing.current = false;
    setJustFinished(false);
    setRunning({
      mode: "pomo",
      phase: "break",
      pomoMs: pendingBreak.long ? pendingBreak.longMs : pendingBreak.shortMs,
      breakMs: pendingBreak.shortMs,
      longBreakMs: pendingBreak.longMs,
      startedAtMs: Date.now(),
      pausedMs: 0,
      pauseStartedAtMs: null,
      link: "",
    });
    setPendingBreak(null);
  }, [pendingBreak]);

  const skipBreak = useCallback((): void => setPendingBreak(null), []);

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
        pendingBreak,
        elapsedMs,
        remainingMs,
        start,
        pause,
        resume,
        finish,
        cancel,
        startBreak,
        skipBreak,
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

/** Start a Pomo linked to a Task, confirming first when a session is already
 * running. The one way to begin a linked Pomo from any trigger — the
 * right-click quick-start menu and the Actions palette's picker share it, so
 * the confirm wording and the task link can't drift apart. Resolves true
 * when a run started, false when the user cancelled the confirm. */
export function useStartPomo(): (taskId: number, pomoMs: number) => Promise<boolean> {
  const { running, finish, start } = useFocusRun();
  return useCallback(
    async (taskId: number, pomoMs: number): Promise<boolean> => {
      if (running !== null) {
        const confirmed = window.confirm(
          "A Focus session is already running. Finish it and start a new one?",
        );
        if (!confirmed) {
          return false;
        }
        await finish();
      }
      start({ mode: "pomo", pomoMs, link: `task:${taskId}` });
      return true;
    },
    [running, finish, start],
  );
}
