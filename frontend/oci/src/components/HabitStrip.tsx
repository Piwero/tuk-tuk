import "./HabitStrip.css";
import { useRailLoad } from "../railLoad";
import { habitCheckInState } from "../todayHabits";
import type { TodayHabits } from "../todayHabits";

/** Phone-only strip under the Today header (#461): one chip per Habit
 * scheduled today, tapped to check in through the same path as the rail's
 * Habits card. Renders nothing while loading, on error, or when none are due. */
export function HabitStrip({ habits }: { habits: TodayHabits }) {
  const { state } = useRailLoad(habits.load);
  if (state.status !== "ready" || state.data.length === 0) return null;
  return (
    <ul className="today-habit-strip" aria-label="Today's Habits">
      {state.data.map((item) => {
        const { complete, label, progress } = habitCheckInState(item);
        return (
          <li key={item.habit.id}>
            <button
              type="button"
              className="habit-chip"
              aria-label={label}
              aria-pressed={complete}
              onClick={() => void habits.checkIn(item)}
            >
              <span aria-hidden="true">{complete ? "✓" : "+"}</span>
              <span className="habit-chip-name">{item.habit.name}</span>
              {progress !== null && item.habit.type === "numeric" && (
                <span className="habit-chip-progress">{progress}</span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
