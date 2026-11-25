import "./NowShortlist.css";
import { useEffect, useRef, useState } from "react";

import { fetchNowShortlist, type Task, updateNowShortlist } from "../api";
import { Modal } from "./Modal";
import { PriorityIndicator } from "./PriorityIndicator";

/** Entries shown before the expand control. */
const VISIBLE = 3;

interface NowShortlistProps {
  /** The User's open Tasks: what the picker offers and where titles come from. */
  tasks: Task[];
  /** The current Now Task, never listed here too. */
  nowTaskId: number | null;
  /** Makes an entry the Now Task; the server then drops it from the list. */
  onPromote: (taskId: number) => void;
}

/** Now shortlist (issue #551): a few ordered alternatives beside Now, in
 * plain Task rows. Every action writes only the shortlist (or Now, for
 * promote) and never touches the Task itself. */
export function NowShortlist({
  tasks,
  nowTaskId,
  onPromote,
}: NowShortlistProps): React.JSX.Element {
  const [ids, setIds] = useState<number[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [picking, setPicking] = useState(false);
  // Keyboard focus must survive a row action (#555): removing or promoting
  // an entry drops its buttons, and a move to either end disables the
  // pressed one. `refocus` names the button to land on once the list renders.
  const sectionRef = useRef<HTMLElement>(null);
  const [refocus, setRefocus] = useState<string | null>(null);
  useEffect(() => {
    if (refocus === null) return;
    const target = [...(sectionRef.current?.querySelectorAll("button") ?? [])].find(
      (b) => b.getAttribute("aria-label") === refocus || b.textContent === refocus,
    );
    if (target !== undefined && !target.disabled) {
      target.focus();
      setRefocus(null);
    }
  });

  // Re-read whenever Now or the open Tasks change: the server prunes the
  // promoted, completed or advanced entries by the same rule as Now.
  const signature = tasks.map((t) => `${t.id}|${t.start_date}|${t.due_date}`).join(",");
  useEffect(() => {
    let live = true;
    void fetchNowShortlist().then((list) => {
      if (live) {
        setIds(list.task_ids);
      }
    });
    return () => {
      live = false;
    };
  }, [nowTaskId, signature]);

  async function save(next: number[]): Promise<void> {
    setIds(next);
    const saved = await updateNowShortlist(next);
    setIds(saved.task_ids);
  }

  function move(index: number, by: number, title: string): void {
    const next = ids.filter((_, i) => i !== index);
    next.splice(index + by, 0, ids[index] ?? 0);
    const to = index + by;
    const atEnd = by < 0 ? to === 0 : to === ids.length - 1;
    if (atEnd) setRefocus(`Move ${title} ${by < 0 ? "down" : "up"}`);
    void save(next);
  }

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const entries = ids.flatMap((id) => byId.get(id) ?? []);
  const shown = expanded ? entries : entries.slice(0, VISIBLE);
  const offered = tasks.filter((t) => !t.completed && t.id !== nowTaskId && !ids.includes(t.id));

  return (
    <section ref={sectionRef} className="now-shortlist" aria-label="Shortlist">
      <div className="now-shortlist-head">
        <span className="now-label">Shortlist</span>
        <button type="button" className="btn-quiet" onClick={() => setPicking(true)}>
          Add to shortlist
        </button>
      </div>
      {entries.length > 0 && (
        <ul className="now-shortlist-rows">
          {shown.map((task, index) => (
            <li key={task.id} className="now-shortlist-row" data-priority={task.priority}>
              <span className="task-row-priority">
                <PriorityIndicator priority={task.priority} />
              </span>
              <span className="now-shortlist-title">{task.title}</span>
              <span className="now-shortlist-actions">
                <button
                  type="button"
                  className="btn-quiet"
                  aria-label={`Make ${task.title} Now`}
                  onClick={() => {
                    setRefocus("Add to shortlist");
                    onPromote(task.id);
                  }}
                >
                  Now
                </button>
                <button
                  type="button"
                  className="btn-quiet"
                  aria-label={`Move ${task.title} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1, task.title)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn-quiet"
                  aria-label={`Move ${task.title} down`}
                  disabled={index === entries.length - 1}
                  onClick={() => move(index, 1, task.title)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn-quiet"
                  aria-label={`Remove ${task.title} from shortlist`}
                  onClick={() => {
                    setRefocus("Add to shortlist");
                    void save(ids.filter((id) => id !== task.id));
                  }}
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {entries.length > VISIBLE && (
        <button
          type="button"
          className="btn-quiet now-shortlist-more"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show fewer" : `Show ${entries.length - VISIBLE} more`}
        </button>
      )}
      {picking && (
        <Modal title="Add to the shortlist" onClose={() => setPicking(false)}>
          {offered.length === 0 ? (
            <p className="now-empty">No other open Tasks.</p>
          ) : (
            <ul className="now-picker">
              {offered.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className="btn-quiet now-picker-option"
                    onClick={() => {
                      setPicking(false);
                      void save([...ids, t.id]);
                    }}
                  >
                    {t.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </section>
  );
}
