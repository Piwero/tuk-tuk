import { useEffect, useState } from "react";

import { fetchFolders, fetchLists, fetchTasks, type Folder, type Task, type TaskList } from "./api";
import { QuickAdd } from "./components/QuickAdd";
import { Sidebar } from "./components/Sidebar";
import { TaskDetail } from "./components/TaskDetail";
import { TaskListView } from "./components/TaskListView";

export function App(): JSX.Element {
  const [lists, setLists] = useState<TaskList[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedListId, setSelectedListId] = useState<number | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    void Promise.all([fetchLists(), fetchFolders()]).then(([listPage, folderPage]) => {
      setLists(listPage.items);
      setFolders(folderPage.items);
    });
  }, []);

  // Keep a valid selection: default to the Inbox, and fall back to it when the
  // selected list disappears (e.g. it was deleted).
  useEffect(() => {
    if (selectedListId !== null && lists.some((list) => list.id === selectedListId)) {
      return;
    }
    const fallback = lists.find((list) => list.is_inbox) ?? lists[0];
    setSelectedListId(fallback === undefined ? null : fallback.id);
  }, [lists, selectedListId]);

  useEffect(() => {
    if (selectedListId === null) {
      return;
    }
    void fetchTasks(selectedListId).then((page) => setTasks(page.items));
  }, [selectedListId]);

  const selectedList = lists.find((list) => list.id === selectedListId) ?? null;
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;

  function applyTaskChange(updated: Task): void {
    setTasks((current) => current.map((task) => (task.id === updated.id ? updated : task)));
  }

  return (
    <div className={selectedTask === null ? "app" : "app with-detail"}>
      <Sidebar
        lists={lists}
        folders={folders}
        selectedListId={selectedListId}
        onSelect={setSelectedListId}
        onListsChanged={setLists}
        onFoldersChanged={setFolders}
        onTaskMoved={(moved) =>
          setTasks((current) =>
            moved.list_id === selectedListId
              ? current.map((task) => (task.id === moved.id ? moved : task))
              : current.filter((task) => task.id !== moved.id),
          )
        }
      />
      <main>
        <h1>{selectedList?.name ?? "tuk-tuk"}</h1>
        {selectedList !== null && (
          <QuickAdd
            listId={selectedList.id}
            onCreated={(task) => setTasks((current) => [...current, task])}
          />
        )}
        <TaskListView tasks={tasks} onChanged={setTasks} onSelect={setSelectedTaskId} />
      </main>
      {selectedTask !== null && (
        <TaskDetail
          task={selectedTask}
          onTaskChanged={applyTaskChange}
          onClose={() => setSelectedTaskId(null)}
        />
      )}
    </div>
  );
}
