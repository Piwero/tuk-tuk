import { deleteTask, updateTask, type Task } from "../api";

interface TaskListViewProps {
  tasks: Task[];
  onChanged: (update: (current: Task[]) => Task[]) => void;
}

export function TaskListView({ tasks, onChanged }: TaskListViewProps): JSX.Element {
  async function toggle(task: Task): Promise<void> {
    const updated = await updateTask(task.id, { completed: !task.completed });
    onChanged((current) => current.map((t) => (t.id === updated.id ? updated : t)));
  }

  async function remove(task: Task): Promise<void> {
    await deleteTask(task.id);
    onChanged((current) => current.filter((t) => t.id !== task.id));
  }

  return (
    <ul className="tasks">
      {tasks.map((task) => (
        <li key={task.id}>
          <label>
            <input
              type="checkbox"
              checked={task.completed}
              aria-label={`Complete ${task.title}`}
              onChange={() => void toggle(task)}
            />
            <span className={task.completed ? "completed" : undefined}>{task.title}</span>
          </label>
          <button
            type="button"
            aria-label={`Delete ${task.title}`}
            onClick={() => void remove(task)}
          >
            Delete
          </button>
        </li>
      ))}
    </ul>
  );
}
