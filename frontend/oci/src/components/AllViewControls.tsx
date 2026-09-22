import { useEffect, useRef, useState } from "react";

import { type AllFilters, type Priority, type Tag, type TaskList } from "../api";
import { PRIORITY_LABELS, type GroupBy, type SortBy } from "../grouping";
import { Hint } from "./Hint";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { SortBySelect } from "./SortBySelect";

interface AllViewControlsProps {
  filters: AllFilters;
  /** Takes an updater rather than the next value: each control changes one
   * field and leaves the rest of the filter state alone. */
  onFiltersUpdate: (update: (current: AllFilters) => AllFilters) => void;
  // ponytail: groupBy/sortBy stay four flat props rather than one bundled
  // "arrangement" type — they're separate state in the app root and this is
  // the only caller, so a type here would be one more indirection for no
  // reader's benefit. Bundle them when a second view needs the same pair.
  groupBy: GroupBy;
  onGroupByChange: (groupBy: GroupBy) => void;
  sortBy: SortBy;
  onSortByChange: (sortBy: SortBy) => void;
  lists: TaskList[];
  tags: Tag[];
}

/** One "narrow the list by X" select: a label, an "Any" escape hatch meaning
 * no filter, and the choices. Shared by List, Tag and Priority so the three
 * read the same way and "Any" can't come to mean different things. */
function FilterSelect<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (value: T | null) => void;
}): JSX.Element {
  return (
    <label>
      {label}
      <select
        value={value ?? ""}
        onChange={(event) => {
          // Read the value out before handing control onward: the caller's
          // updater may run after this handler returns, by which point the
          // event is no longer ours to read.
          const chosen = event.target.value;
          onChange(
            chosen === "" ? null : (options.find((o) => String(o.value) === chosen)?.value ?? null),
          );
        }}
      >
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const BLANK_FILTERS: AllFilters = { listId: null, tagId: null, priority: null };

/** One applied filter as a chip: names the dimension and its value, and
 * offers a single click to clear that dimension alone — the "undo one
 * narrowing without reopening anything" promise from #281. */
function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }): JSX.Element {
  return (
    <span className="filter-chip">
      {label}
      <IconButton icon="x" size={12} label={`Remove filter: ${label}`} onClick={onRemove} />
    </span>
  );
}

/** The List/Tag/Priority filters, collapsed behind one button (#281). The
 * toolbar shows what's on — a quiet button when nothing is filtered, named
 * chips plus a clear-all once something is — rather than three always-open
 * comboboxes announcing what could be turned on. The popover is entirely
 * keyboard-operable: Escape and an outside click both dismiss it and return
 * focus to the button, matching the CreateMenu/Modal pattern used elsewhere. */
function FilterMenu({
  filters,
  onFiltersUpdate,
  lists,
  tags,
}: {
  filters: AllFilters;
  onFiltersUpdate: (update: (current: AllFilters) => AllFilters) => void;
  lists: TaskList[];
  tags: Tag[];
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: MouseEvent): void {
      if (root.current !== null && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const chips: { key: keyof AllFilters; label: string }[] = [];
  if (filters.listId !== null) {
    const list = lists.find((l) => l.id === filters.listId);
    if (list !== undefined) {
      chips.push({ key: "listId", label: `List: ${list.name}` });
    }
  }
  if (filters.tagId !== null) {
    const tag = tags.find((t) => t.id === filters.tagId);
    if (tag !== undefined) {
      chips.push({ key: "tagId", label: `Tag: ${tag.name}` });
    }
  }
  if (filters.priority !== null) {
    chips.push({ key: "priority", label: `Priority: ${PRIORITY_LABELS[filters.priority]}` });
  }

  const count = chips.length;
  const buttonLabel = count === 0 ? "Filters" : `Filters (${count} applied)`;

  return (
    <div className="filter-menu">
      <div className="filter-menu-trigger-row" ref={root}>
        <button
          type="button"
          ref={trigger}
          className="filter-menu-button"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <Icon name="filter" size={14} />
          {buttonLabel}
        </button>
        {chips.map((chip) => (
          <FilterChip
            key={chip.key}
            label={chip.label}
            onRemove={() => onFiltersUpdate((current) => ({ ...current, [chip.key]: null }))}
          />
        ))}
        {count > 1 && (
          <button
            type="button"
            className="filter-menu-clear-all"
            onClick={() => onFiltersUpdate(() => BLANK_FILTERS)}
          >
            Clear all
          </button>
        )}
        {open && (
          <div role="dialog" aria-label="Filters" className="filter-menu-popover">
            <FilterSelect
              label="List"
              value={filters.listId}
              options={lists.map((list) => ({ value: list.id, label: list.name }))}
              onChange={(listId) => onFiltersUpdate((current) => ({ ...current, listId }))}
            />
            <FilterSelect
              label="Tag"
              value={filters.tagId}
              options={tags.map((tag) => ({ value: tag.id, label: tag.name }))}
              onChange={(tagId) => onFiltersUpdate((current) => ({ ...current, tagId }))}
            />
            <FilterSelect
              label="Priority"
              value={filters.priority}
              options={(Object.keys(PRIORITY_LABELS) as Priority[]).map((priority) => ({
                value: priority,
                label: PRIORITY_LABELS[priority],
              }))}
              onChange={(priority) => onFiltersUpdate((current) => ({ ...current, priority }))}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function AllViewControls({
  filters,
  onFiltersUpdate,
  groupBy,
  onGroupByChange,
  sortBy,
  onSortByChange,
  lists,
  tags,
}: AllViewControlsProps): JSX.Element {
  return (
    <div className="view-controls">
      <FilterMenu filters={filters} onFiltersUpdate={onFiltersUpdate} lists={lists} tags={tags} />
      <Hint hintKey="group-by">
        <label>
          Group by
          <select
            value={groupBy}
            onChange={(event) => onGroupByChange(event.target.value as GroupBy)}
          >
            {/* "section" reruns as "None" here — All has no Sections
              of its own, so grouping by one is really no grouping. */}
            <option value="section">None</option>
            <option value="date">Date</option>
            <option value="priority">Priority</option>
            <option value="list">List</option>
          </select>
        </label>
      </Hint>
      <SortBySelect value={sortBy} onChange={onSortByChange} />
    </div>
  );
}
