import { useCallback } from "react";

import { fetchFocusedGoal, type Goal } from "../api";
import { diffDays, localDayOf } from "../dates";
import { RailCard } from "./DayRail";

interface FocusedGoalCardProps {
  /** Goals' URL, so the links work as real links (open in new tab etc.). */
  goalsHref: string;
  onOpenGoals: () => void;
}

/** Rail card: the Focused Goal with its Score and days left (#446). */
export function FocusedGoalCard({ goalsHref, onOpenGoals }: FocusedGoalCardProps) {
  const load = useCallback(() => fetchFocusedGoal(), []);
  function follow(event: React.MouseEvent<HTMLAnchorElement>): void {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    onOpenGoals();
  }
  return (
    <RailCard title="Focused goal" errorMessage="Couldn't load the Focused Goal." load={load}>
      {(goal) =>
        goal === null ? (
          <>
            <p className="rail-card-status">No Focused Goal</p>
            <a className="rail-card-link" href={goalsHref} onClick={follow}>
              Pick a Focused Goal
            </a>
          </>
        ) : (
          <FocusedGoalBody goal={goal} goalsHref={goalsHref} follow={follow} />
        )
      }
    </RailCard>
  );
}

function daysLeftLabel(end: string | null, today: string): string | null {
  if (end === null || end < today) return null;
  const days = diffDays(end, today);
  return days === 0 ? "Last day" : `${days} ${days === 1 ? "day" : "days"} left`;
}

function FocusedGoalBody({
  goal,
  goalsHref,
  follow,
}: {
  goal: Goal;
  goalsHref: string;
  follow: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  const daysLeft = daysLeftLabel(goal.end_date, localDayOf(new Date()));
  const score = goal.score === null ? null : Math.round(goal.score * 100);
  return (
    <>
      <p className="focused-goal-title">{goal.title}</p>
      {score !== null && (
        <div className="focused-goal-score">
          <span>Score {score}%</span>
          <div className="goal-score-track">
            <div
              className="goal-score-bar"
              role="progressbar"
              aria-label={`${goal.title} Score`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={score}
              style={{ ["--goal-score-fill" as string]: `${score}%` }}
            />
          </div>
        </div>
      )}
      {daysLeft !== null && <p className="rail-card-status">{daysLeft}</p>}
      <a className="rail-card-link" href={goalsHref} onClick={follow}>
        Open Goals
      </a>
    </>
  );
}
