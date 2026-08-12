import { useCallback, useEffect, useRef, useState } from "react";

import {
  ApiError,
  createStandupBullet,
  deleteStandupBullet,
  deleteStandupEntry,
  fetchSprintGoal,
  fetchStandupEntries,
  fetchStandupEntry,
  fetchTodaySuggestions,
  fetchYesterdaySuggestions,
  updateStandupBullet,
  updateSprintGoal,
  type StandupBullet,
  type StandupEntry,
  type StandupEntrySummary,
  type StandupSection,
  type StandupSuggestion,
  type StandupYesterdaySuggestion,
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
  // Yesterday-section suggestion chips (issue #141): opt-in, always
  // available, no dependency on Assist — a plain re-run of a deterministic
  // query against completed Tasks/Completed Occurrences for the selected
  // date's prior day. No dismissal/seen-state: reloads every time the
  // selected date changes.
  const [suggestions, setSuggestions] = useState<StandupYesterdaySuggestion[]>([]);
  const [bulletEditor, setBulletEditor] = useState<{ id: number; text: string } | null>(null);
  // Opt-in Today chips, built from the Today Smart List — pure read, no
  // dismissal/seen-state. Blockers has no structured "blocked" concept to
  // suggest from, so only Today gets this treatment.
  const [todaySuggestions, setTodaySuggestions] = useState<StandupSuggestion[]>([]);
  // The live Sprint goal (edited via the header) vs. `goalDraft`, the header
  // input's current text — the entry's snapshot when one exists (a past
  // day's goal never changes retroactively), the live goal otherwise.
  const [liveGoal, setLiveGoal] = useState("");
  const liveGoalRef = useRef("");
  const [goalDraft, setGoalDraft] = useState("");
  // Only a real edit should write the live goal — merely viewing a past
  // Entry's snapshot (which can differ from the live text) and then
  // blurring away, e.g. by picking another date, must not overwrite it.
  const [goalDirty, setGoalDirty] = useState(false);

  const loadHistory = useCallback(async (): Promise<void> => {
    setHistory((await fetchStandupEntries()).items);
  }, []);

  const loadGoal = useCallback(async (): Promise<void> => {
    const goal = await fetchSprintGoal();
    liveGoalRef.current = goal.text;
    setLiveGoal(goal.text);
  }, []);

  const loadTodaySuggestions = useCallback(async (date: string): Promise<void> => {
    setTodaySuggestions(await fetchTodaySuggestions(date));
  }, []);

  const loadYesterdaySuggestions = useCallback(async (date: string): Promise<void> => {
    setSuggestions(await fetchYesterdaySuggestions(date));
  }, []);

  const loadEntry = useCallback(async (date: string): Promise<void> => {
    try {
      const loaded = await fetchStandupEntry(date);
      setEntry(loaded);
      setGoalDraft(loaded.sprint_goal_snapshot);
      setGoalDirty(false);
    } catch (error) {
      if (error instanceof ApiError && error.code === "not_found") {
        setEntry(null);
        setGoalDraft(liveGoalRef.current);
        setGoalDirty(false);
        return;
      }
      throw error;
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    void loadGoal();
  }, [loadGoal]);

  // A date with no persisted Entry tracks the live goal, including updates
  // that land after this date was already selected (e.g. the initial load).
  useEffect(() => {
    if (entry === null) {
      setGoalDraft(liveGoal);
      setGoalDirty(false);
    }
  }, [liveGoal, entry]);

  useEffect(() => {
    setBulletEditor(null);
    setDrafts(emptyDrafts());
    void loadEntry(selectedDate);
    void loadTodaySuggestions(selectedDate);
    void loadYesterdaySuggestions(selectedDate);
  }, [selectedDate, loadEntry, loadTodaySuggestions, loadYesterdaySuggestions]);

  async function saveGoal(): Promise<void> {
    if (!goalDirty) {
      return;
    }
    const goal = await updateSprintGoal(goalDraft);
    liveGoalRef.current = goal.text;
    setLiveGoal(goal.text);
    setGoalDraft(goal.text);
    setGoalDirty(false);
  }

  function bulletsOf(section: StandupSection): StandupBullet[] {
    return entry?.bullets.filter((bullet) => bullet.section === section) ?? [];
  }

  /** Appends a new bullet with `text` to `section`, additively — nothing
   * else in the entry changes. Shared by the manual add-bullet form and
   * suggestion-chip clicks, which just supply different `text`. */
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

  /** A Today chip's click — appends its title as a new bullet, the same
   * additive mechanism as typing it into the Add form, then drops the chip
   * so it can't be added again. */
  async function addTodaySuggestion(suggestion: StandupSuggestion): Promise<void> {
    await appendBullet("today", suggestion.title);
    setTodaySuggestions((current) => current.filter((s) => s.task_id !== suggestion.task_id));
  }

  /** A Yesterday chip click: adds its title as a new bullet, then drops the
   * chip so it can't be added again. No link to the source Task/Completed
   * Occurrence is kept afterward. */
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
        {section === "yesterday" && suggestions.length > 0 && (
          <ul className="standup-suggestions" aria-label="Yesterday suggestions">
            {suggestions.map((suggestion, index) => (
              <li key={`${suggestion.title}-${index}`}>
                <button
                  type="button"
                  className="standup-suggestion-chip"
                  onClick={() => void addYesterdaySuggestion(suggestion.title)}
                >
                  {suggestion.title}
                </button>
              </li>
            ))}
          </ul>
        )}
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
        {section === "today" && todaySuggestions.length > 0 && (
          <ul aria-label="Today suggestions" className="standup-suggestions">
            {todaySuggestions.map((suggestion) => (
              <li key={suggestion.task_id}>
                <button
                  type="button"
                  className="standup-suggestion-chip"
                  onClick={() => void addTodaySuggestion(suggestion)}
                >
                  {suggestion.title}
                </button>
              </li>
            ))}
          </ul>
        )}
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
        <div className="standup-goal">
          <label>
            Sprint goal
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void saveGoal();
              }}
            >
              <input
                aria-label="Sprint goal"
                placeholder="What's the sprint trying to achieve?"
                value={goalDraft}
                onChange={(event) => {
                  setGoalDraft(event.target.value);
                  setGoalDirty(true);
                }}
                onBlur={() => void saveGoal()}
              />
            </form>
          </label>
        </div>
        <div className="standup-sections">
          {SECTIONS.map(({ key, label }) => renderSection(key, label))}
        </div>
      </div>
    </div>
  );
}
