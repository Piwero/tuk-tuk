import { useCallback, useEffect, useRef, useState } from "react";

import {
  ApiError,
  createStandupBullet,
  deleteStandupBullet,
  deleteStandupEntry,
  fetchFocusedGoal,
  fetchStandupEntries,
  fetchStandupEntry,
  fetchTodaySuggestions,
  fetchYesterdaySuggestions,
  updateStandupBullet,
  type Goal,
  type StandupBullet,
  type StandupEntry,
  type StandupEntrySummary,
  type StandupSection,
  type StandupSuggestion,
  type StandupYesterdaySuggestion,
} from "../api";
import { localDayOf, shortDayLabel, weekdayRecordLabel } from "../dates";
import { readDragPayload, startDrag } from "../dnd";
import { appendOrder, planInsertBefore } from "../ordering";
import { IconButton } from "./IconButton";
import { Icon, type IconName } from "./Icon";

const SECTIONS: { key: StandupSection; label: string; icon: IconName }[] = [
  { key: "yesterday", label: "Yesterday", icon: "chevron-left" },
  { key: "today", label: "Today", icon: "sun" },
  { key: "blockers", label: "Blockers", icon: "alert-triangle" },
];

type Drafts = Record<StandupSection, string>;
const emptyDrafts = (): Drafts => ({ yesterday: "", today: "", blockers: "" });

/** The Stand-up screen: a scrollable history of past dates and the selected
 * day's Yesterday / Today / Blockers bullets. Self-fetching, like the
 * Calendar and Habits views. A date with no persisted Entry (any date not
 * in the history list, including today by default) renders an empty,
 * immediately-editable form — the Entry exists only once its first Bullet
 * is saved. */
export function StandupView(): JSX.Element {
  const [history, setHistory] = useState<StandupEntrySummary[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => localDayOf(new Date()));
  const selectedDateRef = useRef(selectedDate);
  selectedDateRef.current = selectedDate;
  const [entry, setEntry] = useState<StandupEntry | null>(null);
  const [drafts, setDrafts] = useState<Drafts>(emptyDrafts());
  const [suggestions, setSuggestions] = useState<StandupYesterdaySuggestion[]>([]);
  const [bulletEditor, setBulletEditor] = useState<{ id: number; text: string } | null>(null);
  const [todaySuggestions, setTodaySuggestions] = useState<StandupSuggestion[]>([]);
  const [focusedGoal, setFocusedGoal] = useState<Goal | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const loadHistory = useCallback(async (): Promise<void> => {
    setHistory((await fetchStandupEntries()).items);
  }, []);

  const loadFocusedGoal = useCallback(async (): Promise<void> => {
    setFocusedGoal(await fetchFocusedGoal());
  }, []);

  const loadTodaySuggestions = useCallback(async (date: string): Promise<void> => {
    const result = await fetchTodaySuggestions(date);
    if (selectedDateRef.current === date) {
      setTodaySuggestions(result);
    }
  }, []);

  const loadYesterdaySuggestions = useCallback(async (date: string): Promise<void> => {
    const result = await fetchYesterdaySuggestions(date);
    if (selectedDateRef.current === date) {
      setSuggestions(result);
    }
  }, []);

  const loadEntry = useCallback(async (date: string): Promise<void> => {
    try {
      const loaded = await fetchStandupEntry(date);
      if (selectedDateRef.current !== date) {
        return;
      }
      setEntry(loaded);
    } catch (error) {
      if (error instanceof ApiError && error.code === "not_found") {
        if (selectedDateRef.current !== date) {
          return;
        }
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
    void loadFocusedGoal();
  }, [loadFocusedGoal]);

  useEffect(() => {
    setBulletEditor(null);
    setDrafts(emptyDrafts());
    void loadEntry(selectedDate);
    void loadTodaySuggestions(selectedDate);
    void loadYesterdaySuggestions(selectedDate);
  }, [selectedDate, loadEntry, loadTodaySuggestions, loadYesterdaySuggestions]);

  function bulletsOf(section: StandupSection): StandupBullet[] {
    return entry?.bullets.filter((bullet) => bullet.section === section) ?? [];
  }

  async function appendBullet(section: StandupSection, text: string): Promise<void> {
    const trimmed = text.trim();
    if (trimmed === "") {
      return;
    }
    setEntry(await createStandupBullet(selectedDate, section, trimmed));
    void loadHistory();
  }

  async function addBullet(section: StandupSection): Promise<void> {
    await appendBullet(section, drafts[section]);
    setDrafts((current) => ({ ...current, [section]: "" }));
  }

  async function addTodaySuggestion(suggestion: StandupSuggestion): Promise<void> {
    await appendBullet("today", suggestion.title);
    setTodaySuggestions((current) => current.filter((s) => s.task_id !== suggestion.task_id));
  }

  async function addYesterdaySuggestion(title: string): Promise<void> {
    await appendBullet("yesterday", title);
    setSuggestions((current) => current.filter((s) => s.title !== title));
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
    let latest = entry;
    for (const { row, sort_order } of plan.rows) {
      latest = await updateStandupBullet(selectedDate, row.id, { sort_order });
    }
    setEntry(latest);
  }

  async function removeEntry(date: string): Promise<void> {
    if (!window.confirm(`Delete the stand-up entry for ${shortDayLabel(date)}?`)) {
      return;
    }
    await deleteStandupEntry(date);
    setHistory((current) => current.filter((item) => item.date !== date));
    if (date === selectedDateRef.current) {
      setEntry(null);
    }
  }

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

  function renderSection(section: StandupSection, label: string, icon: IconName): JSX.Element {
    const bullets = bulletsOf(section);
    const isToday = section === "today";
    const isYesterday = section === "yesterday";
    const sectionSuggestions = isYesterday ? suggestions : isToday ? todaySuggestions : [];
    const hasSuggestions = sectionSuggestions.length > 0;

    return (
      <section className="standup-section" key={section} aria-label={label}>
        <header className="standup-section-header">
          <div className="standup-section-title">
            <span className="standup-section-icon" aria-hidden="true">
              <Icon name={icon} size={16} />
            </span>
            <h3>{label}</h3>
          </div>
          {bullets.length > 0 && (
            <span className="standup-section-count" aria-label={`${bullets.length} bullets`}>
              {bullets.length}
            </span>
          )}
        </header>

        {hasSuggestions && (
          <div className="standup-suggestions" aria-label={`${label} suggestions`}>
            {sectionSuggestions.map((suggestion, index) => {
              if (isYesterday) {
                const ys = suggestion as StandupYesterdaySuggestion;
                return (
                  <button
                    key={`${ys.title}-${index}`}
                    type="button"
                    className="standup-suggestion-chip"
                    onClick={() => void addYesterdaySuggestion(ys.title)}
                  >
                    <span className="standup-suggestion-text">{ys.title}</span>
                    <span className="standup-suggestion-action" aria-hidden="true">
                      <Icon name="plus" size={12} />
                    </span>
                  </button>
                );
              }
              const ts = suggestion as StandupSuggestion;
              return (
                <button
                  key={`${ts.task_id}-${index}`}
                  type="button"
                  className="standup-suggestion-chip"
                  onClick={() => void addTodaySuggestion(ts)}
                >
                  <span className="standup-suggestion-text">{ts.title}</span>
                  <span className="standup-suggestion-action" aria-hidden="true">
                    <Icon name="plus" size={12} />
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <ul
          className="standup-bullets"
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
          {bullets.length === 0 ? (
            <li className="standup-empty-state">
              <p className="standup-empty-text">No {label.toLowerCase()} bullets yet</p>
              <p className="standup-empty-hint">
                {isYesterday
                  ? "Add what you completed yesterday"
                  : isToday
                    ? "Add what you'll tackle today"
                    : "Add anything blocking progress"}
              </p>
            </li>
          ) : (
            bullets.map((bullet) =>
              bulletEditor?.id === bullet.id ? (
                <li key={bullet.id} className="standup-bullet editing">
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void renameBullet();
                    }}
                    className="standup-bullet-edit-form"
                  >
                    <input
                      aria-label={`Edit ${label} bullet`}
                      value={bulletEditor.text}
                      onChange={(event) =>
                        setBulletEditor({ id: bullet.id, text: event.target.value })
                      }
                      onBlur={() => void renameBullet()}
                      autoFocus
                    />
                  </form>
                </li>
              ) : (
                <li
                  key={bullet.id}
                  className="standup-bullet"
                  draggable
                  onDragStart={(event) =>
                    startDrag(event, { kind: "standup-bullet", id: bullet.id })
                  }
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
                  <span className="standup-bullet-text">{bullet.text}</span>
                  <div className="standup-bullet-actions">
                    <IconButton
                      icon="pencil"
                      label={`Edit ${label} bullet`}
                      onClick={() => setBulletEditor({ id: bullet.id, text: bullet.text })}
                    />
                    <IconButton
                      icon="x"
                      label={`Delete ${label} bullet`}
                      onClick={() => void removeBullet(bullet)}
                    />
                  </div>
                </li>
              ),
            )
          )}
        </ul>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void addBullet(section);
          }}
          className="standup-add-form"
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
      <header className="standup-header">
        <div className="standup-header-left">
          {/* Page title is rendered by App.tsx main-header */}
        </div>
        <div className="standup-header-right">
          <div className="standup-date-picker">
            <label htmlFor="standup-date" className="visually-hidden">
              Stand-up date
            </label>
            <input
              id="standup-date"
              type="date"
              value={selectedDate}
              onChange={(event) => {
                setSelectedDate(event.target.value);
                setHistoryOpen(false);
              }}
            />
            <IconButton
              icon="calendar-days"
              label="Open stand-up history"
              className="standup-history-trigger"
              onClick={() => setHistoryOpen(!historyOpen)}
              aria-expanded={historyOpen}
            />
            {historyOpen && history.length > 0 && (
              <div className="standup-history-dropdown" role="listbox" aria-label="Past stand-ups">
                {history.map((item) => (
                  <div
                    key={item.id}
                    role="option"
                    aria-selected={item.date === selectedDate}
                    className={`standup-history-item ${item.date === selectedDate ? "selected" : ""}`}
                  >
                    <button
                      type="button"
                      className="standup-history-item-button"
                      aria-label={`Stand-up entry, ${weekdayRecordLabel(item.date)}`}
                      onClick={() => {
                        setSelectedDate(item.date);
                        setHistoryOpen(false);
                      }}
                    >
                      <span className="standup-history-date">{weekdayRecordLabel(item.date)}</span>
                      <span className="standup-history-short">{shortDayLabel(item.date)}</span>
                      {item.date === selectedDate && (
                        <span className="standup-history-current" aria-hidden="true">
                          Current
                        </span>
                      )}
                    </button>
                    <IconButton
                      icon="x"
                      label={`Delete stand-up ${shortDayLabel(item.date)}`}
                      onClick={() => void removeEntry(item.date)}
                    />
                  </div>
                ))}
                <button
                  type="button"
                  className="standup-history-manage"
                  onClick={(e) => {
                    e.stopPropagation();
                    setHistoryOpen(false);
                  }}
                >
                  <Icon name="layers" size={14} /> Manage all stand-ups
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {focusedGoal && (
        <div className="standup-goal-card" aria-label="Focused goal">
          <div className="standup-goal-header">
            <div className="standup-goal-icon" aria-hidden="true">
              <Icon name="target" size={18} />
            </div>
            <div className="standup-goal-content">
              <p className="standup-goal-label">Focused goal</p>
              <h2 className="standup-goal-title">{focusedGoal.title}</h2>
            </div>
          </div>
          {(focusedGoal.score !== null || focusedGoal.key_results.length > 0) && (
            <div className="standup-goal-progress">
              {focusedGoal.score !== null && (
                <div className="standup-goal-score">
                  <span className="standup-goal-score-value">
                    {Math.round(focusedGoal.score * 100)}%
                  </span>
                  <span className="standup-goal-score-label">Progress</span>
                </div>
              )}
              {focusedGoal.key_results.length > 0 && (
                <ul className="standup-goal-krs" aria-label={`${focusedGoal.title} key results`}>
                  {focusedGoal.key_results.map((kr) => (
                    <li key={kr.id} className="standup-goal-kr">
                      <span className="standup-goal-kr-name">{kr.name}</span>
                      <span className="standup-goal-kr-value">{Math.round(kr.ratio * 100)}%</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {!focusedGoal && (
        <div className="standup-goal-empty" aria-label="No focused goal">
          <div className="standup-goal-empty-icon" aria-hidden="true">
            <Icon name="target" size={24} />
          </div>
          <p className="standup-goal-empty-text">No Goal is focused right now</p>
          <p className="standup-goal-empty-hint">
            Focus a Goal from its card on the Goals page to see it here.
          </p>
        </div>
      )}

      <div className="standup-sections">
        {SECTIONS.map(({ key, label, icon }) => renderSection(key, label, icon))}
      </div>
    </div>
  );
}
