import { type AllFilters, type Priority, type Tag, type TaskList } from "../api";
import { PRIORITY_LABELS, type GroupBy, type SortBy } from "../grouping";
import { CustomSortHint, customSortOptionLabel } from "./CustomSortHint";
import { Hint } from "./Hint";

interface AllViewControlsProps {
  filters: AllFilters;
  onFiltersChange: (update: (current: AllFilters) => AllFilters) => void;
  groupBy: GroupBy;
  onGroupByChange: (groupBy: GroupBy) => void;
  sortBy: SortBy;
  onSortByChange: (sortBy: SortBy) => void;
  lists: TaskList[];
  tags: Tag[];
}

export function AllViewControls({
  filters,
  onFiltersChange,
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
        <label>
          List
          <select
            value={filters.listId ?? ""}
            onChange={(event) =>
              onFiltersChange((current) => ({
                ...current,
                listId: event.target.value === "" ? null : Number(event.target.value),
              }))
            }
          >
            <option value="">Any</option>
            {lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tag
          <select
            value={filters.tagId ?? ""}
            onChange={(event) =>
              onFiltersChange((current) => ({
                ...current,
                tagId: event.target.value === "" ? null : Number(event.target.value),
              }))
            }
          >
            <option value="">Any</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select
            value={filters.priority ?? ""}
            onChange={(event) =>
              onFiltersChange((current) => ({
                ...current,
                priority: event.target.value === "" ? null : (event.target.value as Priority),
              }))
            }
          >
            <option value="">Any</option>
            {(Object.keys(PRIORITY_LABELS) as Priority[]).map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABELS[priority]}
              </option>
            ))}
          </select>
        </label>
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
        <Hint hintKey="sort-by">
          <label>
            Sort by
            <select
              value={sortBy}
              onChange={(event) => onSortByChange(event.target.value as SortBy)}
              aria-describedby="sort-custom-hint-all"
            >
              <option value="custom">{customSortOptionLabel()}</option>
              <option value="date">Date</option>
              <option value="priority">Priority</option>
              <option value="title">Title</option>
            </select>
          </label>
        </Hint>
        {sortBy === "custom" && <CustomSortHint id="sort-custom-hint-all" />}
      </div>
    </>
  );
}
