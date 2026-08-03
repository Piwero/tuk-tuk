import { useFocusRun } from "../focusRunContext";
import { Icon } from "./Icon";

function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = String(Math.floor(total / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

interface FocusNavBadgeProps {
  /** Jumps to the Focus screen — the badge is a shortcut back to the run. */
  onOpen: () => void;
}

/** The Pomo/Stopwatch run, visible from every screen next to the brand — a
 * running or just-finished timer shouldn't require being on the Focus
 * screen to notice. */
export function FocusNavBadge({ onOpen }: FocusNavBadgeProps): JSX.Element | null {
  const { running, justFinished, elapsedMs, remainingMs, dismissFinished } = useFocusRun();

  if (running !== null) {
    const clockMs = running.mode === "pomo" ? remainingMs : elapsedMs;
    const paused = running.pauseStartedAtMs !== null;
    return (
      <button
        type="button"
        className={paused ? "focus-nav-badge paused" : "focus-nav-badge running"}
        onClick={onOpen}
        aria-label={`Focus timer ${paused ? "paused" : "running"}, ${formatClock(clockMs)} left`}
      >
        <Icon name="timer" size={14} />
        <span>{formatClock(clockMs)}</span>
      </button>
    );
  }

  if (justFinished) {
    return (
      <button
        type="button"
        className="focus-nav-badge finished"
        onClick={() => {
          dismissFinished();
          onOpen();
        }}
        aria-label="Focus timer finished"
      >
        <Icon name="timer" size={14} />
        <span>Done</span>
      </button>
    );
  }

  return null;
}
