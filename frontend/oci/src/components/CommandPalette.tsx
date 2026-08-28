import { useEffect, useMemo, useRef, useState } from "react";

import { type Tag, type Task, type TaskList } from "../api";
import {
  flattenGroups,
  groupItems,
  matchesQuery,
  taskVerbs,
  type PaletteItem,
  type TaskVerbId,
} from "../commandPalette";
import { addDays, localDayOf, nextMonday } from "../dates";

/** What the palette does once a Task verb resolves. Every handler is
 * fire-and-forget: the palette closes itself right after calling one. Delete
 * is expected to route through the same undo path a row delete does, and
 * complete through the same deferred PATCH — this component only picks the
 * verb and (for value-taking verbs) the value. */
export interface TaskActionHandlers {
  onComplete: (task: Task) => void;
  onStartFocus: (task: Task) => void;
  /** `day` is a YYYY-MM-DD local day, or null to clear the schedule. */
  onReschedule: (task: Task, day: string | null) => void;
  onMove: (task: Task, listId: number) => void;
  onAddTag: (task: Task, tagId: number) => void;
  /** `recurrence` is RRULE content, or null to stop the Task repeating. */
  onSetRepeat: (task: Task, recurrence: string | null) => void;
  onDelete: (task: Task) => void;
}

interface CommandPaletteProps {
  /** Every jump target the palette offers, already wired to navigate. Used
   * only in jump mode (`task` absent). */
  items: PaletteItem[];
  /** When set, the palette opens scoped to this one Task and offers its
   * verbs instead of jump targets (issue #205). */
  task?: Task;
  /** For the in-surface "Move to a List" picker. */
  lists?: TaskList[];
  /** For the in-surface "Add a Tag" picker. */
  tags?: Tag[];
  /** What the Task verbs do — required whenever `task` is set. */
  actions?: TaskActionHandlers;
  /** Closes the palette. Focus is restored to the opener here in this
   * component, so callers only have to flip their "open" flag. */
  onClose: () => void;
}

/** One selectable line in the palette, whichever mode it is in. */
interface Row {
  key: string;
  label: string;
  run: () => void;
}

const REPEAT_CHOICES: { label: string; recurrence: string | null }[] = [
  { label: "Every day", recurrence: "FREQ=DAILY" },
  { label: "Every week", recurrence: "FREQ=WEEKLY" },
  { label: "Every month", recurrence: "FREQ=MONTHLY" },
  { label: "Every year", recurrence: "FREQ=YEARLY" },
  { label: "Don't repeat", recurrence: null },
];

/** The one overlay opened with cmd/ctrl+K (issue #201), extended in #205 to
 * also act on a single Task in hand.
 *
 * Jump mode: searches Lists, Folders, Tags, Smart Lists, feature views and
 * open Tasks and navigates to the pick.
 *
 * Task mode (`task` set): lists that Task's verbs — complete, start Focus,
 * reschedule, move, add a Tag, set repeat, delete. Verbs that need a value
 * open their picker inside this same surface; Escape steps back out of a
 * picker before it closes the palette. Every verb and every choice is
 * reachable by arrowing and Enter alone.
 *
 * Either way: arrow keys move a single highlight, Enter runs it, Tab is
 * trapped to the query field, and Escape ultimately closes and restores
 * focus to whatever held it when the palette opened. */
export function CommandPalette({
  items,
  task,
  lists,
  tags,
  actions,
  onClose,
}: CommandPaletteProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // Which value-taking verb's picker is open, or null for the verb list.
  const [picker, setPicker] = useState<TaskVerbId | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The last moment the opener still holds focus (see Modal.tsx for the same
  // trick) — restored when the palette unmounts.
  const [opener] = useState(() => document.activeElement as HTMLElement | null);

  const groups = useMemo(
    () => (task === undefined ? groupItems(items, query) : []),
    [items, query, task],
  );
  const jumpFlat = useMemo(() => flattenGroups(groups), [groups]);

  // Task-mode rows: the verb list, or the open picker's choices.
  const taskRows = useMemo<Row[]>(() => {
    if (task === undefined || actions === undefined) {
      return [];
    }
    const close = onClose;
    if (picker === null) {
      return taskVerbs(task)
        .filter((verb) => matchesQuery(verb.label, query))
        .map((verb) => ({
          key: verb.id,
          label: verb.label,
          run: () => {
            if (verb.takesValue) {
              setPicker(verb.id);
              setQuery("");
              setActive(0);
              return;
            }
            if (verb.id === "complete") {
              actions.onComplete(task);
            } else if (verb.id === "focus") {
              actions.onStartFocus(task);
            } else {
              actions.onDelete(task);
            }
            close();
          },
        }));
    }
    let choices: Row[] = [];
    if (picker === "reschedule") {
      const today = localDayOf(new Date());
      const days: { key: string; label: string; day: string | null }[] = [
        { key: "today", label: "Today", day: today },
        { key: "tomorrow", label: "Tomorrow", day: addDays(today, 1) },
        { key: "next-monday", label: "Next Monday", day: nextMonday(today) },
        { key: "no-date", label: "No date", day: null },
      ];
      choices = days.map(({ key, label, day }) => ({
        key,
        label,
        run: () => {
          actions.onReschedule(task, day);
          close();
        },
      }));
    } else if (picker === "move") {
      choices = (lists ?? [])
        .filter((list) => !list.is_archived && list.id !== task.list_id)
        .map((list) => ({
          key: `list-${list.id}`,
          label: list.name,
          run: () => {
            actions.onMove(task, list.id);
            close();
          },
        }));
    } else if (picker === "tag") {
      choices = (tags ?? [])
        .filter((tag) => !task.tags.some((existing) => existing.id === tag.id))
        .map((tag) => ({
          key: `tag-${tag.id}`,
          label: `#${tag.name}`,
          run: () => {
            actions.onAddTag(task, tag.id);
            close();
          },
        }));
    } else if (picker === "repeat") {
      choices = REPEAT_CHOICES.map((choice) => ({
        key: `repeat-${choice.recurrence ?? "none"}`,
        label: choice.label,
        run: () => {
          actions.onSetRepeat(task, choice.recurrence);
          close();
        },
      }));
    }
    return choices.filter((row) => matchesQuery(row.label, query));
  }, [task, actions, picker, query, lists, tags, onClose]);

  const flat = task === undefined ? jumpFlat : taskRows;

  // A narrowing query can leave the highlight past the end of the list.
  useEffect(() => {
    setActive((current) => (current >= flat.length ? 0 : current));
  }, [flat.length]);

  useEffect(() => {
    inputRef.current?.focus();
    return () => opener?.focus();
  }, [opener]);

  function choose(item: { run: () => void } | undefined): void {
    if (item === undefined) {
      return;
    }
    item.run();
    // Jump items only navigate; the palette closes them here. Scoped rows
    // either open a picker (must stay open) or close themselves.
    if (task === undefined) {
      onClose();
    }
  }

  function handleKeyDown(event: React.KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      if (picker !== null) {
        // Step back to the verb list rather than closing outright.
        setPicker(null);
        setQuery("");
        setActive(0);
        return;
      }
      onClose();
      return;
    }
    if (event.key === "Tab") {
      // Only the field is a tab stop — nothing to cycle to, so the trap is
      // just "focus never leaves".
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (flat.length === 0 ? 0 : (current + 1) % flat.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (flat.length === 0 ? 0 : (current - 1 + flat.length) % flat.length));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      choose(flat[active]);
    }
  }

  const activeId = flat[active] === undefined ? undefined : `command-palette-option-${active}`;

  const scoped = task !== undefined;
  const pickerHeadings: Record<TaskVerbId, string> = {
    complete: "",
    focus: "",
    delete: "",
    reschedule: "Reschedule to…",
    move: "Move to which List?",
    tag: "Add which Tag?",
    repeat: "Repeat how often?",
  };
  const heading = scoped
    ? picker !== null
      ? pickerHeadings[picker]
      : `Actions · ${task.title}`
    : null;

  return (
    <div
      className="command-palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label={scoped ? `Actions for ${task.title}` : "Command palette"}
        onKeyDown={handleKeyDown}
      >
        {heading !== null && (
          <div className="command-palette-scope" aria-hidden="true">
            {heading}
          </div>
        )}
        <input
          ref={inputRef}
          type="text"
          className="command-palette-input"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-palette-results"
          aria-activedescendant={activeId}
          aria-label={
            scoped ? `Filter actions for ${task.title}` : "Search Lists, Folders, Tags and Tasks"
          }
          placeholder={scoped ? "Type to filter actions…" : "Jump to a List, Tag, view or Task…"}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div id="command-palette-results" role="listbox" className="command-palette-results">
          {scoped
            ? flat.map((row, index) => (
                <div
                  key={row.key}
                  id={`command-palette-option-${index}`}
                  role="option"
                  aria-selected={index === active}
                  className={
                    index === active ? "command-palette-option active" : "command-palette-option"
                  }
                  onMouseMove={() => setActive(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(row)}
                >
                  {row.label}
                </div>
              ))
            : groups.map((group) => (
                <PaletteGroupRows
                  key={group.kind}
                  group={group}
                  flat={jumpFlat}
                  active={active}
                  setActive={setActive}
                  choose={choose}
                />
              ))}
          {flat.length === 0 && <p className="command-palette-empty">No matches</p>}
        </div>
      </div>
    </div>
  );
}

/** One jump-mode group, rendered with its heading. Split out so the option
 * indices stay in lockstep with `flat` via `indexOf` rather than a shared
 * mutable counter. */
function PaletteGroupRows({
  group,
  flat,
  active,
  setActive,
  choose,
}: {
  group: ReturnType<typeof groupItems>[number];
  flat: PaletteItem[];
  active: number;
  setActive: (index: number) => void;
  choose: (item: PaletteItem) => void;
}): JSX.Element {
  return (
    <div role="group" aria-label={group.heading}>
      <div className="command-palette-heading" aria-hidden="true">
        {group.heading}
      </div>
      {group.items.map((item) => {
        const index = flat.indexOf(item);
        return (
          <div
            key={item.key}
            id={`command-palette-option-${index}`}
            role="option"
            aria-selected={index === active}
            className={
              index === active ? "command-palette-option active" : "command-palette-option"
            }
            onMouseMove={() => setActive(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(item)}
          >
            {item.label}
          </div>
        );
      })}
    </div>
  );
}
