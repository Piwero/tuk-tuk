import { useCallback, useEffect, useState } from "react";

import {
  fetchCompletedOccurrences,
  fetchCompletedTasks,
  fetchFolders,
  fetchLists,
  fetchSections,
  fetchSmartTasks,
  fetchTags,
  fetchTasks,
  fetchTasksByTag,
  updateList,
  SMART_LABELS,
  type CompletedOccurrence,
  type Folder,
  type Section,
  type SmartView,
  type Tag,
  type Task,
  type TaskList,
} from "./api";
import { localDayOf } from "./dates";
import { type GroupBy, type SortBy } from "./grouping";
import { CompletedView } from "./components/CompletedView";
import { KanbanView } from "./components/KanbanView";
import { QuickAdd } from "./components/QuickAdd";
import { Sidebar } from "./components/Sidebar";
import { TaskDetail } from "./components/TaskDetail";
import { TaskListView } from "./components/TaskListView";

/** What the main pane shows: one List, one Tag, or one computed Smart List. */
type View =
  | { kind: "list"; id: number }
  | { kind: "tag"; id: number }
  | { kind: "smart"; view: SmartView }
  | null;

export function App(): JSX.Element {
  const [lists, setLists] = useState<TaskList[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [view, setView] = useState<View>(null);
  // The completed view of the current List (or of All): computed, newest first.
  const [completedMode, setCompletedMode] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  // Completed Occurrences of recurring tasks, shown only in the completed view.
  const [occurrences, setOccurrences] = useState<CompletedOccurrence[]>([]);
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
    if (view?.kind === "smart") {
      return;
    }
    if (view?.kind === "list" && lists.some((list) => list.id === view.id)) {
      return;
    }
    if (view?.kind === "tag" && tags.some((tag) => tag.id === view.id)) {
      return;
    }
    const fallback = lists.find((list) => list.is_inbox) ?? lists[0];
    setCompletedMode(false);
    setView(fallback === undefined ? null : { kind: "list", id: fallback.id });
  }, [lists, tags, view]);

  /** Fetch what the current view shows. Smart Lists and the completed view are
   * computed queries, so edits re-run this rather than patching local state. */
  const loadTasks = useCallback(async (): Promise<void> => {
    if (view === null) {
      return;
    }
    if (completedMode) {
      const scope = view.kind === "list" ? view.id : null;
      const [completedPage, occurrencePage] = await Promise.all([
        fetchCompletedTasks(scope),
        fetchCompletedOccurrences(scope),
      ]);
      setTasks(completedPage.items);
      setOccurrences(occurrencePage.items);
    } else if (view.kind === "smart") {
      setTasks((await fetchSmartTasks(view.view, localDayOf(new Date()))).items);
    } else if (view.kind === "list") {
      setTasks((await fetchTasks(view.id)).items);
    } else {
      setTasks((await fetchTasksByTag(view.id)).items);
    }
  }, [view, completedMode]);

  useEffect(() => {
    if (view === null) {
      return;
    }
    void loadTasks();
    if (view.kind === "list") {
      void fetchSections(view.id).then((page) => setSections(page.items));
    } else {
      setSections([]);
    }
  }, [view, loadTasks]);

  const selectedList =
    view?.kind === "list" ? (lists.find((list) => list.id === view.id) ?? null) : null;
  const selectedTag =
    view?.kind === "tag" ? (tags.find((tag) => tag.id === view.id) ?? null) : null;
  const smartView = view?.kind === "smart" ? view.view : null;
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;
  // Computed views can't be patched locally: membership depends on the query.
  const isComputedView = smartView !== null || completedMode;
  // The completed view exists per List and for All (not Today / Next 7 Days).
  const hasCompletedView = selectedList !== null || smartView === "all";

  function switchView(next: View): void {
    setCompletedMode(false);
    setView(next);
  }

  /** In computed views, apply the optimistic update, then re-run the query —
   * membership is the server's call, not local state's. */
  function changeTasksAndRecompute(update: (current: Task[]) => Task[]): void {
    setTasks(update);
    void loadTasks();
  }

  /** Apply a server response, evicting the task if it left the current view. */
  function applyTaskChange(updated: Task): void {
    if (isComputedView) {
      changeTasksAndRecompute((current) =>
        current.map((task) => (task.id === updated.id ? updated : task)),
      );
      return;
    }
    const stillInView =
      view === null ||
      (view.kind === "list"
        ? updated.list_id === view.id
        : view.kind === "tag" && updated.tags.some((tag) => tag.id === view.id));
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

  async function toggleViewMode(list: TaskList): Promise<void> {
    const updated = await updateList(list.id, {
      view_mode: list.view_mode === "kanban" ? "list" : "kanban",
    });
    setLists((current) => current.map((l) => (l.id === updated.id ? updated : l)));
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
        selectedSmart={smartView}
        onSelect={(listId) => switchView({ kind: "list", id: listId })}
        onSelectTag={(tagId) => switchView({ kind: "tag", id: tagId })}
        onSelectSmart={(smart) => switchView({ kind: "smart", view: smart })}
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
        <div className="main-header">
          <h1>
            {selectedList?.name ??
              (selectedTag
                ? `#${selectedTag.name}`
                : smartView !== null
                  ? SMART_LABELS[smartView]
                  : "tuk-tuk")}
          </h1>
          {selectedList !== null && !completedMode && (
            <button
              type="button"
              className="view-toggle"
              aria-label={
                selectedList.view_mode === "kanban"
                  ? "Switch to list view"
                  : "Switch to kanban view"
              }
              onClick={() => void toggleViewMode(selectedList)}
            >
              {selectedList.view_mode === "kanban" ? "List view" : "Kanban view"}
            </button>
          )}
          {hasCompletedView && (
            <button
              type="button"
              className="completed-toggle"
              onClick={() => setCompletedMode((current) => !current)}
            >
              {completedMode ? "Open tasks" : "Completed"}
            </button>
          )}
        </div>
        {selectedList !== null && selectedList.view_mode === "list" && !completedMode && (
          <>
            <QuickAdd
              listId={selectedList.id}
              lists={lists}
              tags={tags}
              onTagCreated={(tag) => setTags((current) => [...current, tag])}
              onCreated={(task) => {
                // A ~list token may have filed the task elsewhere.
                if (task.list_id === selectedList.id) {
                  setTasks((current) => [...current, task]);
                }
              }}
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
        {completedMode ? (
          <CompletedView
            tasks={tasks}
            occurrences={occurrences}
            onChanged={changeTasksAndRecompute}
            onSelect={setSelectedTaskId}
          />
        ) : selectedList !== null && selectedList.view_mode === "kanban" ? (
          <KanbanView
            tasks={tasks}
            sections={sections}
            listId={selectedList.id}
            onChanged={setTasks}
            onSelect={setSelectedTaskId}
            onSectionsChanged={setSections}
          />
        ) : (
          <TaskListView
            tasks={tasks}
            sections={sections}
            listId={smartView !== null ? null : (selectedList?.id ?? null)}
            groupBy={groupBy}
            sortBy={sortBy}
            onChanged={smartView !== null ? changeTasksAndRecompute : setTasks}
            onSelect={setSelectedTaskId}
            onSectionsChanged={setSections}
          />
        )}
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
