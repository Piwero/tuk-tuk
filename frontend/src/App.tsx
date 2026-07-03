import { useEffect, useState } from "react";

import {
  fetchFolders,
  fetchLists,
  fetchSections,
  fetchTags,
  fetchTasks,
  fetchTasksByTag,
  type Folder,
  type Section,
  type Tag,
  type Task,
  type TaskList,
} from "./api";
import { type GroupBy, type SortBy } from "./grouping";
import { QuickAdd } from "./components/QuickAdd";
import { Sidebar } from "./components/Sidebar";
import { TaskDetail } from "./components/TaskDetail";
import { TaskListView } from "./components/TaskListView";

/** What the main pane shows: one List, or one Tag across all Lists. */
type View = { kind: "list"; id: number } | { kind: "tag"; id: number } | null;

export function App(): JSX.Element {
  const [lists, setLists] = useState<TaskList[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [view, setView] = useState<View>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [groupBy, setGroupBy] = useState<GroupBy>("section");
  const [sortBy, setSortBy] = useState<SortBy>("custom");

  useEffect(() => {
    void Promise.all([fetchLists(), fetchFolders(), fetchTags()]).then(
      ([listPage, folderPage, tagPage]) => {
        setLists(listPage.items);
        setFolders(folderPage.items);
        setTags(tagPage.items);
      },
    );
  }, []);

  // Keep a valid view: default to the Inbox, and fall back to it when the
  // viewed list or tag disappears (e.g. it was deleted).
  useEffect(() => {
    if (view?.kind === "list" && lists.some((list) => list.id === view.id)) {
      return;
    }
    if (view?.kind === "tag" && tags.some((tag) => tag.id === view.id)) {
      return;
    }
    const fallback = lists.find((list) => list.is_inbox) ?? lists[0];
    setView(fallback === undefined ? null : { kind: "list", id: fallback.id });
  }, [lists, tags, view]);

  useEffect(() => {
    if (view === null) {
      return;
    }
    const load = view.kind === "list" ? fetchTasks(view.id) : fetchTasksByTag(view.id);
    void load.then((page) => setTasks(page.items));
    if (view.kind === "list") {
      void fetchSections(view.id).then((page) => setSections(page.items));
    } else {
      setSections([]);
    }
  }, [view]);

  const selectedList =
    view?.kind === "list" ? (lists.find((list) => list.id === view.id) ?? null) : null;
  const selectedTag =
    view?.kind === "tag" ? (tags.find((tag) => tag.id === view.id) ?? null) : null;
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;

  /** Apply a server response, evicting the task if it left the current view. */
  function applyTaskChange(updated: Task): void {
    const stillInView =
      view === null ||
      (view.kind === "list"
        ? updated.list_id === view.id
        : updated.tags.some((tag) => tag.id === view.id));
    setTasks((current) =>
      stillInView
        ? current.map((task) => (task.id === updated.id ? updated : task))
        : current.filter((task) => task.id !== updated.id),
    );
  }

  /** A renamed/recolored Tag must also update the copies embedded in tasks. */
  function applyTagChange(saved: Tag): void {
    setTags((current) => current.map((tag) => (tag.id === saved.id ? saved : tag)));
    setTasks((current) =>
      current.map((task) => ({
        ...task,
        tags: task.tags.map((tag) => (tag.id === saved.id ? saved : tag)),
      })),
    );
  }

  function applyTagDeletion(tagId: number): void {
    setTags((current) => current.filter((tag) => tag.id !== tagId));
    setTasks((current) =>
      current.map((task) => ({
        ...task,
        tags: task.tags.filter((tag) => tag.id !== tagId),
      })),
    );
  }

  return (
    <div className={selectedTask === null ? "app" : "app with-detail"}>
      <Sidebar
        lists={lists}
        folders={folders}
        tags={tags}
        selectedListId={view?.kind === "list" ? view.id : null}
        selectedTagId={view?.kind === "tag" ? view.id : null}
        onSelect={(listId) => setView({ kind: "list", id: listId })}
        onSelectTag={(tagId) => setView({ kind: "tag", id: tagId })}
        onListsChanged={setLists}
        onFoldersChanged={setFolders}
        onTagCreated={(tag) => setTags((current) => [...current, tag])}
        onTagSaved={applyTagChange}
        onTagDeleted={applyTagDeletion}
        onTaskMoved={(moved) =>
          setTasks((current) =>
            view?.kind === "list" && moved.list_id !== view.id
              ? current.filter((task) => task.id !== moved.id)
              : current.map((task) => (task.id === moved.id ? moved : task)),
          )
        }
      />
      <main>
        <h1>{selectedList?.name ?? (selectedTag ? `#${selectedTag.name}` : "tuk-tuk")}</h1>
        {selectedList !== null && (
          <>
            <QuickAdd
              listId={selectedList.id}
              onCreated={(task) => setTasks((current) => [...current, task])}
            />
            <div className="view-controls">
              <label>
                Group by
                <select
                  value={groupBy}
                  onChange={(event) => setGroupBy(event.target.value as GroupBy)}
                >
                  <option value="section">Section</option>
                  <option value="date">Date</option>
                  <option value="priority">Priority</option>
                </select>
              </label>
              <label>
                Sort by
                <select
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value as SortBy)}
                >
                  <option value="custom">Custom</option>
                  <option value="date">Date</option>
                  <option value="priority">Priority</option>
                  <option value="title">Title</option>
                </select>
              </label>
            </div>
          </>
        )}
        <TaskListView
          tasks={tasks}
          sections={sections}
          listId={selectedList?.id ?? null}
          groupBy={groupBy}
          sortBy={sortBy}
          onChanged={setTasks}
          onSelect={setSelectedTaskId}
          onSectionsChanged={setSections}
        />
      </main>
      {selectedTask !== null && (
        <TaskDetail
          task={selectedTask}
          allTags={tags}
          onTaskChanged={applyTaskChange}
          onClose={() => setSelectedTaskId(null)}
        />
      )}
    </div>
  );
}
