import { type AllFilters, type Priority, type Tag, type TaskList } from "../api";
import { PRIORITY_LABELS, type GroupBy, type SortBy } from "../grouping";
import { Hint } from "./Hint";
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
    <>
      <div className="view-controls">
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
      <div className="view-controls">
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
    </>
  );
}
