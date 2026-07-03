import { deleteTask, updateTask, type Task } from "../api";
import { startDrag } from "../dnd";

interface TaskListViewProps {
  tasks: Task[];
  onChanged: (update: (current: Task[]) => Task[]) => void;
  onSelect: (taskId: number) => void;
}

export function TaskListView({ tasks, onChanged, onSelect }: TaskListViewProps): JSX.Element {
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
        <li
          key={task.id}
          data-priority={task.priority}
          draggable
          onDragStart={(event) => startDrag(event, { kind: "task", id: task.id })}
        >
          <label>
            <input
              type="checkbox"
              checked={task.completed}
              aria-label={`Complete ${task.title}`}
              onChange={() => void toggle(task)}
            />
          </label>
          <button
            type="button"
            className="task-title"
            aria-label={`Open details for ${task.title}`}
            onClick={() => onSelect(task.id)}
          >
            <span className={task.completed ? "completed" : undefined}>{task.title}</span>
            {task.check_items.length > 0 && (
              <span className="check-progress">
                {task.check_items.filter((item) => item.done).length}/{task.check_items.length}
              </span>
            )}
          </button>
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
