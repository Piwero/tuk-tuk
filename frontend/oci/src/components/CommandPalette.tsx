import { useEffect, useMemo, useRef, useState } from "react";

import {
  createList,
  createTag,
  createTask,
  type Priority,
  type Tag,
  type Task,
  type TaskList,
} from "../api";
import {
  flattenGroups,
  groupItems,
  matchesQuery,
  taskVerbs,
  type PaletteItem,
  type TaskVerbId,
} from "../commandPalette";
import { addDays, localDayOf, nextMonday } from "../dates";
import { PRIORITY_LABELS } from "../grouping";
import { applyListPick, suggestLists } from "../listSuggest";
import { applyPriorityPick, suggestPriority } from "../prioritySuggest";
import { planPaletteCapture } from "../paletteCapture";
import { applyTagPick, suggestTags } from "../tagSuggest";
import { TokenInput, type TokenChannel } from "./TokenInput";

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
  /** All Lists — capture files a Task into the one a `~list` token or chip
   * names, or `defaultListId` when none does; also feeds the scoped
   * "Move to a List" picker. */
  lists: TaskList[];
  /** All Tags — a `#tag` token only attaches when it matches one of these;
   * capture never creates a Tag from a raw token (issue #204). Also feeds
   * the scoped "Add a Tag" picker. */
  tags: Tag[];
  /** What the Task verbs do — required whenever `task` is set. */
  actions?: TaskActionHandlers;
  /** Where a captured Task lands absent any `~list` token or chip. */
  defaultListId: number;
  /** A Tag was created from the dropdown's "Create …" row. */
  onTagCreated: (tag: Tag) => void;
  /** A List was created from the dropdown's "Create …" row. */
  onListCreated: (list: TaskList) => void;
  /** A Task was captured — the host shows it without a refetch. */
  onCreated: (task: Task) => void;
  /** Closes the palette. Focus is restored to the opener here in this
   * component, so callers only have to flip their "open" flag. */
  onClose: () => void;
}

/** One selectable line — a Task verb, a verb's picker choice, or a jump
 * target normalised into the same shape. */
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

/** Run one of the verbs that has no picker. */
function runValuelessVerb(id: TaskVerbId, task: Task, actions: TaskActionHandlers): void {
  if (id === "complete") {
    actions.onComplete(task);
  } else if (id === "focus") {
    actions.onStartFocus(task);
  } else {
    actions.onDelete(task);
  }
}

/** The choices a value-taking verb's picker offers, each wired to apply
 * itself and then close. The single place a `TaskVerbId` fans out to its
 * options. */
function pickerChoices(
  picker: TaskVerbId,
  task: Task,
  actions: TaskActionHandlers,
  lists: TaskList[],
  tags: Tag[],
  close: () => void,
): Row[] {
  switch (picker) {
    case "reschedule": {
      const today = localDayOf(new Date());
      return [
        { key: "today", label: "Today", day: today },
        { key: "tomorrow", label: "Tomorrow", day: addDays(today, 1) },
        { key: "next-monday", label: "Next Monday", day: nextMonday(today) },
        { key: "no-date", label: "No date", day: null as string | null },
      ].map(({ key, label, day }) => ({
        key,
        label,
        run: () => {
          actions.onReschedule(task, day);
          close();
        },
      }));
    }
    case "move":
      return lists
        .filter((list) => !list.is_archived && list.id !== task.list_id)
        .map((list) => ({
          key: `list-${list.id}`,
          label: list.name,
          run: () => {
            actions.onMove(task, list.id);
            close();
          },
        }));
    case "tag":
      return tags
        .filter((tag) => !task.tags.some((existing) => existing.id === tag.id))
        .map((tag) => ({
          key: `tag-${tag.id}`,
          label: `#${tag.name}`,
          run: () => {
            actions.onAddTag(task, tag.id);
            close();
          },
        }));
    case "repeat":
      return REPEAT_CHOICES.map((choice) => ({
        key: `repeat-${choice.recurrence ?? "none"}`,
        label: choice.label,
        run: () => {
          actions.onSetRepeat(task, choice.recurrence);
          close();
        },
      }));
    default:
      return [];
  }
}

/** The one overlay opened with cmd/ctrl+K (issue #201).
 *
 * Jump mode: searches Lists, Folders, Tags, Smart Lists, feature views and
 * open Tasks and navigates to the pick, and — via the "New task" row
 * (issue #204) — captures a Task with the same `#tag` / `!priority` / `~list`
 * shortcuts the Quick-Add bar parses, all without touching the pointer.
 *
 * Task mode (`task` set, issue #205): lists that Task's verbs — complete,
 * start Focus, reschedule, move, add a Tag, set repeat, delete. Verbs that
 * need a value open their picker inside this same surface; Escape steps back
 * out of a picker before it closes the palette.
 *
 * Either way: arrow keys move a single highlight, Enter runs it, Escape
 * closes and restores focus to whatever held it when the palette opened. Tab
 * is trapped: the query field is the only tab stop, and every result is
 * still reachable by arrowing. */
export function CommandPalette({
  items,
  task,
  lists,
  tags,
  actions,
  defaultListId,
  onTagCreated,
  onListCreated,
  onCreated,
  onClose,
}: CommandPaletteProps): JSX.Element {
  // Scoped mode's verb filter text.
  const [query, setQuery] = useState("");
  // Jump mode's field doubles as a Task-capture bar (issue #204): the typed
  // text, plus any #tag / ~list / !priority chips picked from the sigil
  // dropdowns. The same three channels the Quick-Add bar uses.
  const [captureText, setCaptureText] = useState("");
  const [tagChips, setTagChips] = useState<Tag[]>([]);
  const [listChip, setListChip] = useState<TaskList[]>([]);
  const [priorityChip, setPriorityChip] = useState<Priority[]>([]);
  const [active, setActive] = useState(0);
  // Which value-taking verb's picker is open, or null for the verb list.
  const [picker, setPicker] = useState<TaskVerbId | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Blocks a second createTask while the first is still in flight — an Enter
  // repeat, or Enter racing a click on the "New task" row.
  const committing = useRef(false);
  // The last moment the opener still holds focus (see Modal.tsx for the same
  // trick) — restored when the palette unmounts.
  const [opener] = useState(() => document.activeElement as HTMLElement | null);

  const scoped = task !== undefined;

  // The typed text with its #tag / ~list / !priority tokens parsed out — a
  // chip preview and, once there's a title, the exact createTask payload.
  // Jump results filter on the *stripped* title, so "Buy milk ~read" narrows
  // the jump list to "Buy milk".
  const capturePlan = useMemo(
    () =>
      planPaletteCapture(
        captureText,
        { tags: tagChips, list: listChip, priority: priorityChip },
        lists,
        tags,
        defaultListId,
      ),
    [captureText, tagChips, listChip, priorityChip, lists, tags, defaultListId],
  );
  const jumpQuery = capturePlan.preview.title;

  const groups = useMemo(
    () => (scoped ? [] : groupItems(items, jumpQuery)),
    [items, jumpQuery, scoped],
  );
  const jumpFlat = useMemo(() => flattenGroups(groups), [groups]);

  // Scoped mode: the verb list, or the open picker's choices — filtered by
  // the same query the jump list uses.
  const taskRows = useMemo<Row[]>(() => {
    if (task === undefined || actions === undefined) {
      return [];
    }
    const rows: Row[] =
      picker === null
        ? taskVerbs(task).map((verb) => ({
            key: verb.id,
            label: verb.label,
            run: () => {
              if (verb.pickerHeading !== null) {
                setPicker(verb.id);
                setQuery("");
                setActive(0);
              } else {
                runValuelessVerb(verb.id, task, actions);
                onClose();
              }
            },
          }))
        : pickerChoices(picker, task, actions, lists, tags, onClose);
    return rows.filter((row) => matchesQuery(row.label, query));
  }, [task, actions, picker, query, lists, tags, onClose]);

  // Jump mode reserves index 0 for the "New task" row and offsets the jump
  // results by one; scoped mode navigates `taskRows` directly.
  const rows = scoped ? taskRows : jumpFlat;
  const total = scoped ? rows.length : rows.length + 1;

  // A narrowing query can leave the highlight past the end of the list.
  useEffect(() => {
    setActive((current) => (current >= total ? 0 : current));
  }, [total]);

  useEffect(() => {
    inputRef.current?.focus();
    return () => opener?.focus();
  }, [opener]);

  /** The "New task" row's commit — the same createTask payload
   * `planPaletteCapture` builds, guarded against a double submit. */
  async function commitCapture(): Promise<void> {
    const commit = capturePlan.commit;
    if (commit === null || committing.current) {
      return;
    }
    committing.current = true;
    try {
      const created = await createTask({
        title: commit.title,
        list_id: commit.listId,
        ...(commit.priority === null ? {} : { priority: commit.priority }),
        ...(commit.tagIds.length === 0 ? {} : { tag_ids: commit.tagIds }),
      });
      onCreated(created);
      onClose();
    } finally {
      committing.current = false;
    }
  }

  const tagChannel: TokenChannel<Tag> = {
    sigil: "#",
    mode: "multi",
    chips: tagChips,
    onChipsChange: setTagChips,
    getId: (tag) => tag.id,
    getLabel: (tag) => tag.name,
    suggest: (text, caret) => suggestTags(text, caret, tags),
    applyPick: applyTagPick,
    allowCreate: true,
    onCreate: (name) => createTag({ name }),
    onCreated: onTagCreated,
    createLabel: (name) => `Create tag "${name}"`,
    removeAriaLabel: (tag) => `Remove ${tag.name}`,
  };

  const listChannel: TokenChannel<TaskList> = {
    sigil: "~",
    mode: "single",
    chips: listChip,
    onChipsChange: setListChip,
    getId: (list) => list.id,
    getLabel: (list) => list.name,
    suggest: (text, caret) => suggestLists(text, caret, lists),
    applyPick: applyListPick,
    allowCreate: true,
    onCreate: (name) => createList({ name }),
    onCreated: onListCreated,
    createLabel: (name) => `Create list "${name}"`,
    removeAriaLabel: (list) => `Remove ${list.name}`,
  };

  const priorityChannel: TokenChannel<Priority> = {
    sigil: "!",
    mode: "single",
    chips: priorityChip,
    onChipsChange: setPriorityChip,
    getId: (priority) => priority,
    getLabel: (priority) => PRIORITY_LABELS[priority],
    suggest: (text, caret) => suggestPriority(text, caret),
    applyPick: applyPriorityPick,
    allowCreate: false,
    createLabel: (name) => name,
    removeAriaLabel: (priority) => `Remove ${priority}`,
  };

  function choose(row: Row | PaletteItem | undefined): void {
    if (row === undefined) {
      return;
    }
    row.run();
    // Jump items only navigate; the palette closes them here. Scoped rows
    // either open a picker (must stay open) or close themselves.
    if (!scoped) {
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
      setActive((current) => (current + 1) % total);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (current - 1 + total) % total);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (scoped) {
        choose(rows[active]);
      } else if (active === 0) {
        void commitCapture();
      } else {
        choose(rows[active - 1]);
      }
    }
  }

  const heading = scoped
    ? picker !== null
      ? (taskVerbs(task).find((verb) => verb.id === picker)?.pickerHeading ?? "")
      : `Actions · ${task.title}`
    : null;

  const captureRowLabel = jumpQuery.trim() === "" ? "New task" : `New task: "${jumpQuery.trim()}"`;
  const activeId = active >= total ? undefined : `command-palette-option-${active}`;

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
        <>
          {heading !== null && (
            <div className="command-palette-scope" aria-hidden="true">
              {heading}
            </div>
          )}
          {scoped ? (
            <input
              ref={inputRef}
              type="text"
              className="command-palette-input"
              role="combobox"
              aria-expanded="true"
              aria-controls="command-palette-results"
              aria-activedescendant={activeId}
              aria-label={`Filter actions for ${task.title}`}
              placeholder="Type to filter actions…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          ) : (
            <TokenInput
              ariaLabel="Search views and Tasks, or type a new Task"
              placeholder="Jump to anything, or type a new Task…"
              value={captureText}
              onValueChange={setCaptureText}
              autoFocus
              channels={[
                tagChannel as TokenChannel<unknown>,
                listChannel as TokenChannel<unknown>,
                priorityChannel as TokenChannel<unknown>,
              ]}
              sigilHints={
                <>
                  <span className="quick-add-sigil-hint">{tagChannel.sigil}tag</span>
                  <span className="quick-add-sigil-hint">{priorityChannel.sigil}priority</span>
                  <span className="quick-add-sigil-hint">{listChannel.sigil}list</span>
                </>
              }
            />
          )}
          <div id="command-palette-results" role="listbox" className="command-palette-results">
            {scoped ? (
              <>
                {taskRows.map((row, index) => (
                  <PaletteOption
                    key={row.key}
                    index={index}
                    label={row.label}
                    active={index === active}
                    setActive={setActive}
                    onPick={() => choose(row)}
                  />
                ))}
                {taskRows.length === 0 && <p className="command-palette-empty">No matches</p>}
              </>
            ) : (
              <>
                <div role="group" aria-label="Create">
                  <div className="command-palette-heading" aria-hidden="true">
                    Create
                  </div>
                  <PaletteOption
                    index={0}
                    label={captureRowLabel}
                    active={active === 0}
                    setActive={setActive}
                    onPick={() => void commitCapture()}
                  />
                  {captureText.trim() !== "" && (
                    <div
                      className="command-palette-capture-preview"
                      role="group"
                      aria-label="New task"
                    >
                      <span className="tag-chip token-chip">
                        {capturePlan.preview.title === "" ? "New task" : capturePlan.preview.title}
                      </span>
                      {capturePlan.preview.list !== null && (
                        <span className="list-chip token-chip">
                          {capturePlan.preview.list.name}
                        </span>
                      )}
                      {capturePlan.preview.priority !== null && (
                        <span className="tag-chip token-chip">
                          {PRIORITY_LABELS[capturePlan.preview.priority]}
                        </span>
                      )}
                      {capturePlan.preview.tags.map((tag) => (
                        <span
                          key={tag.name}
                          className={
                            tag.tagId === null
                              ? "tag-chip token-chip command-palette-chip-unmatched"
                              : "tag-chip token-chip"
                          }
                          title={
                            tag.tagId === null
                              ? "No matching Tag — pick one or it is dropped"
                              : undefined
                          }
                        >
                          #{tag.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {groups.map((group) => (
                  <PaletteGroupRows
                    key={group.kind}
                    group={group}
                    flat={jumpFlat}
                    active={active}
                    indexOffset={1}
                    setActive={setActive}
                    choose={choose}
                  />
                ))}
                {groups.length === 0 && <p className="command-palette-empty">No matches</p>}
              </>
            )}
          </div>
        </>
      </div>
    </div>
  );
}

/** One `role="option"` row — the same markup whether it is a scoped verb,
 * a "New task" row, or a jump target. `index` is its position in the single
 * moving highlight, which is also its DOM id suffix. */
function PaletteOption({
  index,
  label,
  active,
  setActive,
  onPick,
}: {
  index: number;
  label: string;
  active: boolean;
  setActive: (index: number) => void;
  onPick: () => void;
}): JSX.Element {
  return (
    <div
      id={`command-palette-option-${index}`}
      role="option"
      aria-selected={active}
      className={active ? "command-palette-option active" : "command-palette-option"}
      onMouseMove={() => setActive(index)}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPick}
    >
      {label}
    </div>
  );
}

/** One jump-mode group, rendered with its heading. Split out so the option
 * indices stay in lockstep with `flat` via `indexOf` (plus the reserved
 * "New task" row) rather than a shared mutable counter. */
function PaletteGroupRows({
  group,
  flat,
  active,
  indexOffset,
  setActive,
  choose,
}: {
  group: ReturnType<typeof groupItems>[number];
  flat: PaletteItem[];
  active: number;
  indexOffset: number;
  setActive: (index: number) => void;
  choose: (item: PaletteItem) => void;
}): JSX.Element {
  return (
    <div role="group" aria-label={group.heading}>
      <div className="command-palette-heading" aria-hidden="true">
        {group.heading}
      </div>
      {group.items.map((item) => {
        const index = flat.indexOf(item) + indexOffset;
        return (
          <PaletteOption
            key={item.key}
            index={index}
            label={item.label}
            active={index === active}
            setActive={setActive}
            onPick={() => choose(item)}
          />
        );
      })}
    </div>
  );
}
