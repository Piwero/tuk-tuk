import "./DayRail.css";
import { useRailLoad } from "../railLoad";

interface RailCardProps<T> {
  title: string;
  /** Sentence shown with the Retry button when loading fails. */
  errorMessage: string;
  load: () => Promise<T>;
  children: (data: T) => React.ReactNode;
}

/** The rail's card frame: a labelled region with loading, error + Retry, and
 * the card's own body once its data arrives. New rail cards (Habits, Focus)
 * pass their `load` and render function here. */
export function RailCard<T>({ title, errorMessage, load, children }: RailCardProps<T>) {
  const { state, retry } = useRailLoad(load);
  const headingId = `rail-card-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section className="rail-card" aria-labelledby={headingId}>
      <h2 id={headingId} className="rail-card-title">
        {title}
      </h2>
      {state.status === "loading" ? (
        <p className="rail-card-status" aria-busy="true">
          Loading…
        </p>
      ) : state.status === "error" ? (
        <div className="rail-card-error" role="alert">
          <p className="rail-card-status">{errorMessage}</p>
          <button type="button" className="btn-secondary" onClick={retry}>
            Retry
          </button>
        </div>
      ) : (
        children(state.data)
      )}
    </section>
  );
}

/** The right-hand rail beside Today (#427). It is a sibling of the Task list
 * inside `.main-content`; DayRail.css shows it only when the content area is
 * wide enough to hold both, so the Task list never shrinks to make room.
 * Cards are children, each gated by its feature toggle at the call site. */
export function DayRail({ children }: { children: React.ReactNode }) {
  return (
    <aside className="day-rail" aria-label="Day">
      {children}
    </aside>
  );
}
