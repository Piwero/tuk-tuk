import "./FocusCard.css";
import { useCallback } from "react";

import { localDayOf } from "../dates";
import { useFocusRun } from "../focusRunContext";
import { formatFocusTotal, loadFocusDays, pomoOfCycle } from "../focusTotals";
import { RailCard } from "./DayRail";

interface FocusCardProps {
  /** Focus's URL, so the link works as a real link (open in new tab etc.). */
  focusHref: string;
  onOpenFocus: () => void;
}

/** Rail card: today's Focus time and the Pomos done this cycle (#448).
 * Today's total comes from the same Focus statistics as Focus itself, and
 * reloads whenever a Focus Session is recorded. */
export function FocusCard({ focusHref, onOpenFocus }: FocusCardProps) {
  const { pomoStreak, sessionsRecorded } = useFocusRun();
  const load = useCallback(() => {
    void sessionsRecorded; // a new recorded session means fresh totals
    const today = localDayOf(new Date());
    return loadFocusDays(today, today).then((days) => days[0]?.seconds ?? 0);
  }, [sessionsRecorded]);
  function follow(event: React.MouseEvent<HTMLAnchorElement>): void {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    onOpenFocus();
  }
  return (
    <RailCard title="Focus" errorMessage="Couldn't load today's Focus." load={load}>
      {(seconds) => (
        <>
          <p className="focus-card-total">{formatFocusTotal(seconds)}</p>
          <p className="rail-card-status">{pomoOfCycle(pomoStreak)}</p>
          <a className="rail-card-link" href={focusHref} onClick={follow}>
            Open Focus
          </a>
        </>
      )}
    </RailCard>
  );
}
