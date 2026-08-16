import {
  updateTask,
  type Priority,
  type SearchFilters,
  type Tag,
  type Task,
  type TaskList,
} from "../api";
import { PRIORITY_LABELS } from "../grouping";
import { TaskRow } from "./TaskRow";

/** What the search view shows: the query and its narrowing filters. */
export interface SearchState extends SearchFilters {
  query: string;
}

interface SearchViewProps {
  tasks: Task[];
  lists: TaskList[];
  tags: Tag[];
  state: SearchState;
  onStateChange: (state: SearchState) => void;
  onChanged: (update: (current: Task[]) => Task[]) => void;
  onSelect: (taskId: number) => void;
}

/** Search results with the List / Tag / Priority / status filters. The query
 * itself lives in the sidebar's search box; results open the detail panel. */
export function SearchView({
  tasks,
  lists,
  tags,
  state,
  onStateChange,
  onChanged,
  onSelect,
}: SearchViewProps): JSX.Element {
  async function toggle(task: Task): Promise<void> {
    const updated = await updateTask(task.id, { completed: !task.completed });
    onChanged((current) => current.map((t) => (t.id === updated.id ? updated : t)));
  }
  return (
    <div className="search-view">
      <div className="view-controls">
        <label>
          List
          <select
            value={state.listId ?? ""}
            onChange={(event) =>
              onStateChange({
                ...state,
                listId: event.target.value === "" ? null : Number(event.target.value),
              })
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
            value={state.tagId ?? ""}
            onChange={(event) =>
              onStateChange({
                ...state,
                tagId: event.target.value === "" ? null : Number(event.target.value),
              })
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
            value={state.priority ?? ""}
            onChange={(event) =>
              onStateChange({
                ...state,
                priority: event.target.value === "" ? null : (event.target.value as Priority),
              })
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
        <label>
          Status
          <select
            value={state.completed === null ? "" : state.completed ? "completed" : "open"}
            onChange={(event) =>
              onStateChange({
                ...state,
                completed: event.target.value === "" ? null : event.target.value === "completed",
              })
            }
          >
            <option value="">All</option>
            <option value="open">Open</option>
            <option value="completed">Completed</option>
          </select>
        </label>
      </div>
      {state.query.trim() === "" ? (
        <p className="search-hint">Type to search</p>
      ) : tasks.length === 0 ? (
        <p className="search-hint">No matches for “{state.query.trim()}”</p>
      ) : (
        <ul className="search-results tasks">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              list={lists.find((list) => list.id === task.list_id)}
              showDate
              showTags
              showCheckProgress
              onToggle={(t) => void toggle(t)}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
