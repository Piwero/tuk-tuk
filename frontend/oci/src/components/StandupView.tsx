import { useCallback, useEffect, useState } from "react";

import {
  ApiError,
  createStandupBullet,
  deleteStandupBullet,
  deleteStandupEntry,
  fetchStandupEntries,
  fetchStandupEntry,
  updateStandupBullet,
  type StandupBullet,
  type StandupEntry,
  type StandupEntrySummary,
  type StandupSection,
} from "../api";
import { localDayOf, shortDayLabel } from "../dates";
import { readDragPayload, startDrag } from "../dnd";
import { appendOrder, planInsertBefore } from "../ordering";
import { Icon } from "./Icon";

const SECTIONS: { key: StandupSection; label: string }[] = [
  { key: "yesterday", label: "Yesterday" },
  { key: "today", label: "Today" },
  { key: "blockers", label: "Blockers" },
];

type Drafts = Record<StandupSection, string>;
const emptyDrafts = (): Drafts => ({ yesterday: "", today: "", blockers: "" });

/** The Stand-up screen: a scrollable history of past dates and the selected
 * day's Yesterday / Today / Blockers bullets. Self-fetching, like the
 * Calendar and Habits views. A date with no persisted Entry (any date not
 * in the history list, including today by default) renders an empty,
 * immediately-editable form — the Entry exists only once its first Bullet
 * is saved.
 */
export function StandupView(): JSX.Element {
  const [history, setHistory] = useState<StandupEntrySummary[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => localDayOf(new Date()));
  const [entry, setEntry] = useState<StandupEntry | null>(null);
  const [drafts, setDrafts] = useState<Drafts>(emptyDrafts);
  const [bulletEditor, setBulletEditor] = useState<{ id: number; text: string } | null>(null);

  const loadHistory = useCallback(async (): Promise<void> => {
    setHistory((await fetchStandupEntries()).items);
  }, []);

  const loadEntry = useCallback(async (date: string): Promise<void> => {
    try {
      setEntry(await fetchStandupEntry(date));
    } catch (error) {
      if (error instanceof ApiError && error.code === "not_found") {
        setEntry(null);
        return;
      }
      throw error;
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    setBulletEditor(null);
    setDrafts(emptyDrafts());
    void loadEntry(selectedDate);
  }, [selectedDate, loadEntry]);

  function bulletsOf(section: StandupSection): StandupBullet[] {
    return entry?.bullets.filter((bullet) => bullet.section === section) ?? [];
  }

  async function addBullet(section: StandupSection): Promise<void> {
    const trimmed = drafts[section].trim();
    if (trimmed === "") {
      return;
    }
    setEntry(await createStandupBullet(selectedDate, section, trimmed));
    setDrafts((current) => ({ ...current, [section]: "" }));
    void loadHistory();
  }

  async function renameBullet(): Promise<void> {
    if (bulletEditor === null) {
      return;
    }
    const trimmed = bulletEditor.text.trim();
    if (trimmed !== "") {
      setEntry(await updateStandupBullet(selectedDate, bulletEditor.id, { text: trimmed }));
    }
    setBulletEditor(null);
  }

  async function removeBullet(bullet: StandupBullet): Promise<void> {
    await deleteStandupBullet(selectedDate, bullet.id);
    setEntry((current) =>
      current === null
        ? null
        : { ...current, bullets: current.bullets.filter((b) => b.id !== bullet.id) },
    );
  }

  async function moveBulletBefore(bulletId: number, target: StandupBullet): Promise<void> {
    if (entry === null || bulletId === target.id) {
      return;
    }
    const moved = entry.bullets.find((b) => b.id === bulletId);
    if (moved === undefined || moved.section !== target.section) {
      return;
    }
    const siblings = bulletsOf(target.section).filter((b) => b.id !== bulletId);
    const plan = planInsertBefore(siblings, moved, target.id);
    if (plan.kind === "single") {
      setEntry(await updateStandupBullet(selectedDate, bulletId, { sort_order: plan.sort_order }));
      return;
    }
    // Gap exhausted: renumber the section; the last response carries the final order.
    let latest = entry;
    for (const { row, sort_order } of plan.rows) {
      latest = await updateStandupBullet(selectedDate, row.id, { sort_order });
    }
    setEntry(latest);
  }

  /** Dropping on a section's list itself (below the rows) moves the bullet to its end. */
  async function moveBulletToEnd(bulletId: number, section: StandupSection): Promise<void> {
    if (entry === null) {
      return;
    }
    const moved = entry.bullets.find((b) => b.id === bulletId);
    if (moved === undefined || moved.section !== section) {
      return;
    }
    const siblings = bulletsOf(section).filter((b) => b.id !== bulletId);
    setEntry(
      await updateStandupBullet(selectedDate, bulletId, { sort_order: appendOrder(siblings) }),
    );
  }

  async function removeEntry(date: string): Promise<void> {
    await deleteStandupEntry(date);
    setHistory((current) => current.filter((item) => item.date !== date));
    if (date === selectedDate) {
      setEntry(null);
    }
  }

  function renderSection(section: StandupSection, label: string): JSX.Element {
    const bullets = bulletsOf(section);
    return (
      <section className="standup-section" key={section} aria-label={label}>
        <h3>{label}</h3>
        <ul
          aria-label={`${label} bullets`}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const payload = readDragPayload(event);
            if (payload?.kind === "standup-bullet") {
              void moveBulletToEnd(payload.id, section);
            }
          }}
        >
          {bullets.map((bullet) =>
            bulletEditor?.id === bullet.id ? (
              <li key={bullet.id}>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void renameBullet();
                  }}
                >
                  <input
                    aria-label={`Edit ${label} bullet`}
                    value={bulletEditor.text}
                    onChange={(event) =>
                      setBulletEditor({ id: bullet.id, text: event.target.value })
                    }
                    onBlur={() => void renameBullet()}
                  />
                </form>
              </li>
            ) : (
              <li
                key={bullet.id}
                draggable
                onDragStart={(event) => startDrag(event, { kind: "standup-bullet", id: bullet.id })}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const payload = readDragPayload(event);
                  if (payload?.kind === "standup-bullet") {
                    void moveBulletBefore(payload.id, bullet);
                  }
                }}
              >
                <span>{bullet.text}</span>
                <span className="row-actions">
                  <button
                    type="button"
                    aria-label={`Edit ${label} bullet ${bullet.text}`}
                    onClick={() => setBulletEditor({ id: bullet.id, text: bullet.text })}
                  >
                    <Icon name="pencil" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${label} bullet ${bullet.text}`}
                    onClick={() => void removeBullet(bullet)}
                  >
                    <Icon name="x" />
                  </button>
                </span>
              </li>
            ),
          )}
        </ul>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void addBullet(section);
          }}
        >
          <input
            aria-label={`Add a ${label} bullet`}
            placeholder={`Add to ${label}…`}
            value={drafts[section]}
            onChange={(event) =>
              setDrafts((current) => ({ ...current, [section]: event.target.value }))
            }
          />
        </form>
      </section>
    );
  }

  return (
    <div className="standup-view">
      <aside className="standup-history" aria-label="Stand-up history">
        <label>
          Date
          <input
            type="date"
            aria-label="Stand-up date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
          />
        </label>
        <ul aria-label="Past stand-ups">
          {history.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-current={item.date === selectedDate ? "true" : undefined}
                onClick={() => setSelectedDate(item.date)}
              >
                {shortDayLabel(item.date)}
              </button>
              <button
                type="button"
                aria-label={`Delete stand-up ${item.date}`}
                onClick={() => void removeEntry(item.date)}
              >
                <Icon name="x" />
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="standup-detail">
        {SECTIONS.map(({ key, label }) => renderSection(key, label))}
      </div>
    </div>
  );
}
