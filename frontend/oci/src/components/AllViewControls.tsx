import "./AllViewControls.css";
import { useEffect, useRef, useState } from "react";

import { type AllFilters, type Priority, type Tag, type TaskList } from "../api";
import { PRIORITY_LABELS, type GroupBy, type SortBy } from "../grouping";
import { Hint } from "./Hint";
import { Icon } from "./Icon";
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

/** How many of the three filter dimensions are narrowing the list. */
function appliedCount(filters: AllFilters): number {
  return [filters.listId, filters.tagId, filters.priority].filter((v) => v !== null).length;
}

interface ViewMenuProps {
  /** Omitted on views with nothing to filter (a plain List): the menu then
   * holds only Group by and Sort by. */
  filters?: AllFilters;
  onFiltersUpdate?: (update: (current: AllFilters) => AllFilters) => void;
  groupBy: GroupBy;
  onGroupByChange: (groupBy: GroupBy) => void;
  /** Group-by choices for this view, in display order. */
  groupOptions: { value: GroupBy; label: string }[];
  sortBy: SortBy;
  onSortByChange: (sortBy: SortBy) => void;
  lists: TaskList[];
  tags: Tag[];
}

/** One View button holding Filters, Group by and Sort by (#445), replacing
 * the permanent toolbar. The button carries the "a filter is narrowing this
 * list" signal both visibly (`is-filtered` + count badge) and in its
 * accessible name. Escape and an outside click dismiss the menu and return
 * focus to the button, matching the CreateMenu/Modal pattern. */
export function ViewMenu({
  filters,
  onFiltersUpdate,
  groupBy,
  onGroupByChange,
  groupOptions,
  sortBy,
  onSortByChange,
  lists,
  tags,
}: ViewMenuProps): JSX.Element {
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

  const count = filters === undefined ? 0 : appliedCount(filters);
  const label =
    count === 0 ? "View" : `View, ${count} ${count === 1 ? "filter" : "filters"} applied`;

  return (
    <div className="view-controls">
      <div className="view-menu" ref={root}>
        <button
          type="button"
          ref={trigger}
          className={count > 0 ? "view-menu-button is-filtered" : "view-menu-button"}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={label}
          onClick={() => setOpen((current) => !current)}
        >
          <Icon name="filter" size={14} />
          View
          {count > 0 && (
            <span className="view-menu-count" aria-hidden="true">
              {count}
            </span>
          )}
        </button>
        {open && (
          <div role="dialog" aria-label="View" className="view-menu-popover">
            {filters !== undefined && onFiltersUpdate !== undefined && (
              <fieldset className="view-menu-filters">
                <legend>Filters</legend>
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
                {count > 0 && (
                  <button
                    type="button"
                    className="view-menu-clear btn-quiet"
                    onClick={() => onFiltersUpdate(() => BLANK_FILTERS)}
                  >
                    Clear filters
                  </button>
                )}
              </fieldset>
            )}
            <Hint hintKey="group-by">
              <label>
                Group by
                <select
                  value={groupBy}
                  onChange={(event) => onGroupByChange(event.target.value as GroupBy)}
                >
                  {groupOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </Hint>
            <SortBySelect value={sortBy} onChange={onSortByChange} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Smart Lists' group choices: "section" reads as "None" — Smart Lists have
 * no Sections of their own, so grouping by one is really no grouping. */
const SMART_GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "section", label: "None" },
  { value: "date", label: "Date" },
  { value: "priority", label: "Priority" },
  { value: "list", label: "List" },
];

/** The Smart List View menu: Filters plus Group by and Sort by. */
export function AllViewControls(props: AllViewControlsProps): JSX.Element {
  return <ViewMenu {...props} groupOptions={SMART_GROUP_OPTIONS} />;
}
