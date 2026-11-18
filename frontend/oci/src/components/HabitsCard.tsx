import { habitCheckInState } from "../todayHabits";
import type { TodayHabits } from "../todayHabits";
import { RailCard } from "./DayRail";

interface HabitsCardProps {
  habitsHref: string;
  onOpenHabits: () => void;
  /** The shared Check-in path from `useTodayHabits` (also drives the chip strip). */
  habits: TodayHabits;
}

/** Rail card: the Habits scheduled today with done count and one-tap Check-in (#447). */
export function HabitsCard({ habitsHref, onOpenHabits, habits }: HabitsCardProps) {
  const { load, checkIn } = habits;

  function follow(event: React.MouseEvent<HTMLAnchorElement>): void {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    onOpenHabits();
  }

  return (
    <RailCard title="Habits" errorMessage="Couldn't load your Habits." load={load}>
      {(items) => {
        const done = items.filter((i) => i.value >= i.habit.target).length;
        return (
          <>
            <p className="rail-card-status">
              {items.length === 0 ? "No Habits scheduled today" : `${done} of ${items.length} done`}
            </p>
            <ul className="rail-habits">
              {items.map((item) => {
                const { habit, streak } = item;
                const { complete, label, progress } = habitCheckInState(item);
                return (
                  <li key={habit.id} className="rail-habit">
                    <button
                      type="button"
                      className="btn-secondary rail-habit-check"
                      aria-label={label}
                      aria-pressed={complete}
                      onClick={() => void checkIn(item)}
                    >
                      {complete ? "✓" : "+"}
                    </button>
                    <span className="rail-habit-name">{habit.name}</span>
                    {progress !== null && <span className="rail-habit-progress">{progress}</span>}
                    <span className="rail-habit-streak">Streak: {streak}</span>
                  </li>
                );
              })}
            </ul>
            <a className="rail-card-link" href={habitsHref} onClick={follow}>
              Open Habits
            </a>
          </>
        );
      }}
    </RailCard>
  );
}
