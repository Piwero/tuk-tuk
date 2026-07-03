import { useEffect, useState } from "react";

import { fetchLists, fetchTasks, type Task, type TaskList } from "./api";
import { QuickAdd } from "./components/QuickAdd";
import { TaskListView } from "./components/TaskListView";

export function App(): JSX.Element {
  const [lists, setLists] = useState<TaskList[]>([]);
  const [selectedList, setSelectedList] = useState<TaskList | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    void fetchLists().then((page) => {
      setLists(page.items);
      setSelectedList(page.items.find((list) => list.is_inbox) ?? page.items[0] ?? null);
    });
  }, []);

  useEffect(() => {
    if (selectedList === null) {
      return;
    }
    void fetchTasks(selectedList.id).then((page) => setTasks(page.items));
  }, [selectedList]);

  return (
    <div className="app">
      <aside className="sidebar">
        <nav aria-label="Lists">
          <ul>
            {lists.map((list) => (
              <li key={list.id}>
                <button type="button" onClick={() => setSelectedList(list)}>
                  {list.name}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <main>
        <h1>{selectedList?.name ?? "tuk-tuk"}</h1>
        {selectedList !== null && (
          <QuickAdd
            listId={selectedList.id}
            onCreated={(task) => setTasks((current) => [...current, task])}
          />
        )}
        <TaskListView tasks={tasks} onChanged={setTasks} />
      </main>
    </div>
  );
}
