import type { CheckItem, Task } from "../api";
import { Modal } from "./Modal";

interface TimerFreeWorkProps {
  task: Task;
  /** Ticks a Check Item exactly as the Now panel does. */
  onTick: (task: Task, item: CheckItem) => void;
  onComplete: (task: Task) => void;
  onLeave: () => void;
}

/** Work without timer (issue #553): the Now Task and its next Check Item,
 * with completion controls and deliberately no clock, dial or minutes. It
 * records nothing, so leaving needs no review step. */
export function TimerFreeWork({
  task,
  onTick,
  onComplete,
  onLeave,
}: TimerFreeWorkProps): React.JSX.Element {
  // Check Items arrive in their sort order; the first open one is the next step.
  const next = task.check_items.find((item) => !item.done);

  return (
    <Modal title="Work without timer" onClose={onLeave}>
      <div className="now-focus">
        <p className="now-title">{task.title}</p>
        {next !== undefined ? (
          <label className="now-step">
            <input
              type="checkbox"
              checked={false}
              aria-label={`Tick ${next.title}`}
              onChange={() => onTick(task, next)}
            />
            <span>{next.title}</span>
          </label>
        ) : (
          <div className="now-step">
            {task.check_items.length > 0 && (
              <span className="now-empty">All Check Items done.</span>
            )}
            <button
              type="button"
              className="btn-secondary"
              aria-label={`Complete ${task.title}`}
              onClick={() => {
                onLeave();
                onComplete(task);
              }}
            >
              Complete Task
            </button>
          </div>
        )}
      </div>
      <div className="now-actions">
        <button type="button" className="btn-quiet now-secondary" onClick={onLeave}>
          Leave
        </button>
      </div>
    </Modal>
  );
}
