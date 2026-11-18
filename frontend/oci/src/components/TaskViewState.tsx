import "./TaskViewState.css";

/** Placeholder rows while a Task view loads (#441): each sits at the Task
 * row's own height, so the view doesn't jump when the real rows arrive, and
 * the region is announced as busy rather than as an empty view. */
export function SkeletonRows({ count = 5 }: { count?: number }): JSX.Element {
  return (
    <div role="status" aria-label="Loading tasks" aria-busy="true" className="skeleton-rows">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="skeleton-row" aria-hidden="true">
          <span className="skeleton-check" />
          <span className="skeleton-line" />
        </div>
      ))}
    </div>
  );
}

interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** A loaded view with nothing in it (#441): what the view is for, plus its
 * main action as a button. */
export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps): JSX.Element {
  return (
    <section className="empty-state" aria-labelledby="empty-state-title">
      <h2 id="empty-state-title">{title}</h2>
      <p>{description}</p>
      {actionLabel !== undefined && onAction !== undefined && (
        <button type="button" className="btn-primary" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </section>
  );
}

/** A failed load (#441): says what failed, offers Retry. */
export function LoadError({ what, onRetry }: { what: string; onRetry: () => void }): JSX.Element {
  return (
    <div role="alert" className="load-error">
      <p className="load-error-title">Couldn’t load {what}</p>
      <p>Check your connection and try again.</p>
      <button type="button" className="btn-secondary" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
