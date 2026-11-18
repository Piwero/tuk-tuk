import "./AllViewControls.css";
import { useRef, useState } from "react";

import { type AllFilters, type Priority, type Tag, type TaskList } from "../api";
import { PRIORITY_LABELS, type GroupBy, type SortBy } from "../grouping";
import { Hint } from "./Hint";
import { Icon } from "./Icon";
import { Popover } from "./Popover";
import { SortBySelect } from "./SortBySelect";

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
  const trigger = useRef<HTMLButtonElement>(null);

  const count = filters === undefined ? 0 : appliedCount(filters);
  const label =
    count === 0 ? "View" : `View, ${count} ${count === 1 ? "filter" : "filters"} applied`;

  return (
    <div className="view-controls">
      <div className="view-menu">
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
        <Popover open={open} triggerRef={trigger} onClose={() => setOpen(false)}>
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
        </Popover>
      </div>
    </div>
  );
}

/** Smart Lists' group choices: "section" reads as "None" — Smart Lists have
 * no Sections of their own, so grouping by one is really no grouping. */
export const SMART_GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "section", label: "None" },
  { value: "date", label: "Date" },
  { value: "priority", label: "Priority" },
  { value: "list", label: "List" },
];
