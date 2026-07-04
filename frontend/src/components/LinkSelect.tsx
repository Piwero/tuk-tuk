import { type Habit, type Task } from "../api";
import { type FocusLink } from "../focusLink";

export interface LinkSelectProps {
  /** The select's accessible name (the timer and the forms differ). */
  label: string;
  tasks: Task[];
  habits: Habit[];
  value: FocusLink;
  disabled?: boolean;
  onChange: (link: FocusLink) => void;
}

/** The "at most one link" picker a Focus Session offers: none, one Task, or
 * one Habit. */
export function LinkSelect({
  label,
  tasks,
  habits,
  value,
  disabled = false,
  onChange,
}: LinkSelectProps): JSX.Element {
  return (
    <label>
      {label}
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as FocusLink)}
      >
        <option value="">No link</option>
        <optgroup label="Tasks">
          {tasks.map((task) => (
            <option key={task.id} value={`task:${task.id}`}>
              {task.title}
            </option>
          ))}
        </optgroup>
        <optgroup label="Habits">
          {habits.map((habit) => (
            <option key={habit.id} value={`habit:${habit.id}`}>
              {habit.name}
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  );
}
