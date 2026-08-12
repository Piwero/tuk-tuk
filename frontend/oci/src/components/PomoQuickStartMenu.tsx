import { useEffect, useRef, useState } from "react";

import { fetchTimers, type Task, type Timer } from "../api";
import { useFocusRun } from "../focusRunContext";

const DEFAULT_POMO_MINUTES = 25;
const POMO_LABEL = (minutes: number) => `Focus: ${minutes}min`;

export interface PomoQuickStartMenuProps {
  /** The Task this quick-start session links to, regardless of any link a
   * chosen Timer carries of its own. */
  task: Task;
  /** Viewport coordinates to anchor the menu at (cursor position). */
  position: { x: number; y: number };
  onClose: () => void;
}

/** A right-click quick-start menu for beginning a Pomo linked to a Task: the
 * user's saved Pomo Timers (or a built-in 25-minute default when there are
 * none), plus a "Custom…" row for a one-off length. Drives the session
 * lifecycle entirely through `useFocusRun()` so it stays reusable, unmodified,
 * from any trigger (right-click today; a kebab button and Calendar entries in
 * follow-on work). */
export function PomoQuickStartMenu({
  task,
  position,
  onClose,
}: PomoQuickStartMenuProps): JSX.Element {
  const { running, finish, start } = useFocusRun();
  const [timers, setTimers] = useState<Timer[]>([]);
  const [customOpen, setCustomOpen] = useState(false);
  const [customMinutes, setCustomMinutes] = useState(String(DEFAULT_POMO_MINUTES));
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchTimers().then((page) => {
      if (!cancelled) {
        setTimers(page.items);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onPointerDown(event: MouseEvent): void {
      if (root.current !== null && !root.current.contains(event.target as Node)) {
        onClose();
      }
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") {
        return;
      }
      if (customOpen) {
        setCustomOpen(false);
      } else {
        onClose();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [customOpen, onClose]);

  async function startPomo(pomoMs: number): Promise<void> {
    if (running !== null) {
      const confirmed = window.confirm(
        "A Focus session is already running. Finish it and start a new one?",
      );
      if (!confirmed) {
        return;
      }
      await finish();
    }
    start({ mode: "pomo", pomoMs, link: `task:${task.id}` });
    onClose();
  }

  function submitCustom(event: React.FormEvent): void {
    event.preventDefault();
    const minutes = Number(customMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return;
    }
    void startPomo(minutes * 60_000);
  }

  const pomoTimers = timers.filter((timer) => timer.mode === "pomo");

  return (
    <div
      className="pomo-quick-start-menu"
      ref={root}
      style={{ position: "fixed", left: position.x, top: position.y }}
    >
      {customOpen ? (
        <form onSubmit={submitCustom}>
          <input
            type="number"
            min={1}
            aria-label="Custom Pomo minutes"
            autoFocus
            value={customMinutes}
            onChange={(event) => setCustomMinutes(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setCustomOpen(false);
              }
            }}
          />
        </form>
      ) : (
        <ul role="menu" aria-label={`Start Focus for ${task.title}`}>
          {pomoTimers.length > 0 ? (
            pomoTimers.map((timer) => (
              <li role="none" key={timer.id}>
                <button
                  type="button"
                  role="menuitem"
                  className="pomo-timer-button"
                  onClick={() => void startPomo((timer.duration_seconds ?? 0) * 1000)}
                >
                  {timer.name}
                </button>
              </li>
            ))
          ) : (
            <li role="none">
              <button
                type="button"
                role="menuitem"
                className="pomo-timer-button"
                onClick={() => void startPomo(DEFAULT_POMO_MINUTES * 60_000)}
              >
                {POMO_LABEL(DEFAULT_POMO_MINUTES)}
              </button>
            </li>
          )}
          <li role="none">
            <button
              type="button"
              role="menuitem"
              className="pomo-timer-button"
              onClick={() => setCustomOpen(true)}
            >
              Custom…
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
