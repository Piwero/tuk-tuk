import { useEffect, useRef, useState } from "react";

import {
  updateTask,
  type Priority,
  type SearchFilters,
  type Tag,
  type Task,
  type TaskList,
} from "../api";
import { useDebouncedValue } from "../debounce";
import { PRIORITY_LABELS } from "../grouping";
import { Icon } from "./Icon";
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

/** How long typing must pause before a keystroke turns into a fetch — long
 * enough that a normal typing cadence never fires one per letter, short
 * enough that the results still feel live (issue #167). */
const SEARCH_DEBOUNCE_MS = 300;

/** Search results with the List / Tag / Priority / status filters. The
 * query lives on this page's own field, focused on arrival — the sidebar
 * carries a separate quick-jump field of its own (issue #167). */
export function SearchView({
  tasks,
  lists,
  tags,
  state,
  onStateChange,
  onChanged,
  onSelect,
}: SearchViewProps): JSX.Element {
  // What the field shows, updated on every keystroke; `state.query` (what
  // actually drives the fetch) only follows once typing pauses, below.
  const [queryDraft, setQueryDraft] = useState(state.query);
  const debouncedQuery = useDebouncedValue(queryDraft, SEARCH_DEBOUNCE_MS);
  // The last value this view itself pushed up, so the sync effect below
  // can tell "the debounce just landed" (ignore) from "the query changed
  // out from under us" (e.g. the sidebar's own field was submitted while
  // this view was already open — pick it up).
  const lastPushedQuery = useRef(state.query);
  const fieldRef = useRef<HTMLInputElement>(null);

  // Focused on arrival: this component only exists while /search is showing,
  // so mount is arrival (issue #167).
  useEffect(() => {
    fieldRef.current?.focus();
  }, []);

  useEffect(() => {
    if (debouncedQuery !== state.query) {
      lastPushedQuery.current = debouncedQuery;
      onStateChange({ ...state, query: debouncedQuery });
    }
    // Only the settled query should push a change — depending on `state` or
    // `onStateChange` here would refire this on every filter change too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery]);

  useEffect(() => {
    if (state.query !== lastPushedQuery.current) {
      lastPushedQuery.current = state.query;
      setQueryDraft(state.query);
    }
  }, [state.query]);

  async function toggle(task: Task): Promise<void> {
    const updated = await updateTask(task.id, { completed: !task.completed });
    onChanged((current) => current.map((t) => (t.id === updated.id ? updated : t)));
  }

  const trimmedQuery = state.query.trim();

  return (
    <div className="search-view">
      <form role="search" className="search-field" onSubmit={(event) => event.preventDefault()}>
        <Icon name="search" size={16} />
        <input
          ref={fieldRef}
          type="search"
          aria-label="Search tasks"
          placeholder="Search tasks…"
          value={queryDraft}
          onChange={(event) => setQueryDraft(event.target.value)}
        />
      </form>
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
      {trimmedQuery === "" ? (
        <p className="search-hint">Type to search</p>
      ) : tasks.length === 0 ? (
        <p className="search-hint">No matches for “{trimmedQuery}”</p>
      ) : (
        <>
          <p className="search-count">
            {tasks.length} {tasks.length === 1 ? "result" : "results"}
          </p>
          <ul className="search-results tasks">
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                list={lists.find((list) => list.id === task.list_id)}
                showDate
                showTags
                showCheckProgress
                highlight={trimmedQuery}
                onToggle={(t) => void toggle(t)}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
