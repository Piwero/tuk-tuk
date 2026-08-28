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
import { flattenGroups, groupItems, type PaletteItem } from "../commandPalette";
import { PRIORITY_LABELS } from "../grouping";
import { applyListPick, suggestLists } from "../listSuggest";
import { applyPriorityPick, suggestPriority } from "../prioritySuggest";
import { planPaletteCapture } from "../paletteCapture";
import { applyTagPick, suggestTags } from "../tagSuggest";
import { TokenInput, type TokenChannel } from "./TokenInput";

interface CommandPaletteProps {
  /** Every jump target the palette offers, already wired to navigate. */
  items: PaletteItem[];
  /** All Lists — capture files a Task into the one a `~list` token or chip
   * names, or `defaultListId` when none does. */
  lists: TaskList[];
  /** All Tags — a `#tag` token only attaches when it matches one of these;
   * capture never creates a Tag from a raw token (issue #204). */
  tags: Tag[];
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

/** The one overlay opened with cmd/ctrl+K (issue #201). Searches Lists,
 * Folders, Tags, Smart Lists, feature views and open Tasks and navigates to
 * the pick, and — via the "New task" row (issue #204) — captures a Task
 * with the same `#tag` / `!priority` / `~list` shortcuts the Quick-Add bar
 * parses, all without touching the pointer.
 *
 * Arrow keys move a single highlight through every matched item (grouped by
 * kind), Enter runs the highlighted one, Escape closes and restores focus to
 * whatever held it when the palette opened. Tab is trapped: the query field
 * is the only tab stop, and every result is still reachable by arrowing. */
export function CommandPalette({
  items,
  lists,
  tags,
  defaultListId,
  onTagCreated,
  onListCreated,
  onCreated,
  onClose,
}: CommandPaletteProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState<"jump" | "capture">("jump");
  const inputRef = useRef<HTMLInputElement>(null);
  // The last moment the opener still holds focus (see Modal.tsx for the same
  // trick) — restored when the palette unmounts.
  const [opener] = useState(() => document.activeElement as HTMLElement | null);

  // --- Capture mode state ---------------------------------------------------
  const [captureText, setCaptureText] = useState("");
  const [tagChips, setTagChips] = useState<Tag[]>([]);
  const [listChip, setListChip] = useState<TaskList[]>([]);
  const [priorityChip, setPriorityChip] = useState<Priority[]>([]);
  const committing = useRef(false);

  const groups = useMemo(() => groupItems(items, query), [items, query]);
  const flat = useMemo(() => flattenGroups(groups), [groups]);
  // The "New task" entry is always the first stop; the jump results follow.
  const total = flat.length + 1;

  // A narrowing query can leave the highlight past the end of the list.
  useEffect(() => {
    setActive((current) => (current >= total ? 0 : current));
  }, [total]);

  useEffect(() => {
    if (mode === "jump") {
      inputRef.current?.focus();
    }
    return () => opener?.focus();
  }, [opener, mode]);

  function choose(item: PaletteItem | undefined): void {
    if (item === undefined) {
      return;
    }
    item.run();
    onClose();
  }

  function enterCapture(): void {
    setCaptureText(query);
    setTagChips([]);
    setListChip([]);
    setPriorityChip([]);
    setMode("capture");
  }

  function handleKeyDown(event: React.KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (mode === "capture") {
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
      if (active === 0) {
        enterCapture();
      } else {
        choose(flat[active - 1]);
      }
    }
  }

  const { preview, commit } = planPaletteCapture(
    captureText,
    { tags: tagChips, list: listChip, priority: priorityChip },
    lists,
    tags,
    defaultListId,
  );

  async function commitCapture(): Promise<void> {
    if (commit === null || committing.current) {
      return;
    }
    committing.current = true;
    try {
      const task = await createTask({
        title: commit.title,
        list_id: commit.listId,
        ...(commit.priority === null ? {} : { priority: commit.priority }),
        ...(commit.tagIds.length === 0 ? {} : { tag_ids: commit.tagIds }),
      });
      onCreated(task);
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

  const captureRowLabel = query.trim() === "" ? "New task" : `New task: "${query.trim()}"`;
  const activeId =
    mode === "capture"
      ? undefined
      : active === 0
        ? "command-palette-option-0"
        : flat[active - 1] === undefined
          ? undefined
          : `command-palette-option-${active}`;
  let flatIndex = 0;

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
        aria-label="Command palette"
        onKeyDown={handleKeyDown}
      >
        {mode === "capture" ? (
          <div
            className="command-palette-capture"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.defaultPrevented) {
                event.preventDefault();
                event.stopPropagation();
                void commitCapture();
              }
            }}
          >
            <TokenInput
              ariaLabel="New task title"
              placeholder="Task title — #tag !priority ~list"
              value={captureText}
              onValueChange={setCaptureText}
              autoFocus
              channels={[
                tagChannel as TokenChannel<unknown>,
                listChannel as TokenChannel<unknown>,
                priorityChannel as TokenChannel<unknown>,
              ]}
            />
            <div className="command-palette-capture-preview" role="group" aria-label="New task">
              <span className="tag-chip token-chip">
                {preview.title === "" ? "New task" : preview.title}
              </span>
              {preview.list !== null && (
                <span className="list-chip token-chip">{preview.list.name}</span>
              )}
              {preview.priority !== null && (
                <span className="tag-chip token-chip">{PRIORITY_LABELS[preview.priority]}</span>
              )}
              {preview.tags.map((tag) => (
                <span
                  key={tag.name}
                  className={
                    tag.tagId === null
                      ? "tag-chip token-chip command-palette-chip-unmatched"
                      : "tag-chip token-chip"
                  }
                  title={
                    tag.tagId === null ? "No matching Tag — pick one or it is dropped" : undefined
                  }
                >
                  #{tag.name}
                </span>
              ))}
            </div>
            <button
              type="button"
              className="command-palette-capture-commit"
              disabled={!preview.ready}
              onClick={() => void commitCapture()}
            >
              Create task
            </button>
          </div>
        ) : (
          <>
            <input
              ref={inputRef}
              type="text"
              className="command-palette-input"
              role="combobox"
              aria-expanded="true"
              aria-controls="command-palette-results"
              aria-activedescendant={activeId}
              aria-label="Search Lists, Folders, Tags and Tasks"
              placeholder="Jump to a List, Tag, view or Task…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div id="command-palette-results" role="listbox" className="command-palette-results">
              <div role="group" aria-label="Create">
                <div className="command-palette-heading" aria-hidden="true">
                  Create
                </div>
                <div
                  id="command-palette-option-0"
                  role="option"
                  aria-selected={active === 0}
                  className={
                    active === 0 ? "command-palette-option active" : "command-palette-option"
                  }
                  onMouseMove={() => setActive(0)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={enterCapture}
                >
                  {captureRowLabel}
                </div>
              </div>
              {groups.map((group) => (
                <div key={group.kind} role="group" aria-label={group.heading}>
                  <div className="command-palette-heading" aria-hidden="true">
                    {group.heading}
                  </div>
                  {group.items.map((item) => {
                    flatIndex += 1;
                    const index = flatIndex;
                    return (
                      <div
                        key={item.key}
                        id={`command-palette-option-${index}`}
                        role="option"
                        aria-selected={index === active}
                        className={
                          index === active
                            ? "command-palette-option active"
                            : "command-palette-option"
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
              ))}
              {groups.length === 0 && <p className="command-palette-empty">No matches</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
