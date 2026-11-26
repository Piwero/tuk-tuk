import "./GitHubFreshness.css";

import { useEffect, useState } from "react";

/** "fetched 42 s ago", "fetched 3 min ago", "fetched 2 h ago". */
function formatFetchedAgo(fetchedAt: Date, now: Date): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - fetchedAt.getTime()) / 1000));
  if (seconds < 60) return `fetched ${seconds} s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `fetched ${minutes} min ago`;
  return `fetched ${Math.floor(minutes / 60)} h ago`;
}

/** The current time, ticking every second, so an age label stays true. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** How fresh a GitHub view read is (#583): when its data was fetched from
 * GitHub, which the backend caches for a minute, and Refresh to read from
 * GitHub now. */
export function GitHubFreshness({
  fetchedAt,
  refreshing,
  onRefresh,
}: {
  fetchedAt: string;
  refreshing: boolean;
  onRefresh: () => void;
}): React.JSX.Element {
  const now = useNow();
  return (
    <div className="github-freshness">
      <time dateTime={fetchedAt}>{formatFetchedAgo(new Date(fetchedAt), now)}</time>
      <button type="button" className="btn-secondary" disabled={refreshing} onClick={onRefresh}>
        Refresh
      </button>
    </div>
  );
}

/** Shown when GitHub couldn't be reached and the view shows an earlier
 * result instead (#583): the backend keeps one for 10 minutes. */
export function GitHubStaleNotice({
  fetchedAt,
  onRetry,
}: {
  fetchedAt: string;
  onRetry: () => void;
}): React.JSX.Element {
  const now = useNow();
  return (
    <div className="github-stale" role="status" aria-label="Stale GitHub results">
      <p>
        {`GitHub couldn’t be reached, so these results were ${formatFetchedAgo(new Date(fetchedAt), now)}. `}
        <button type="button" className="btn-quiet" onClick={onRetry}>
          Retry
        </button>
      </p>
    </div>
  );
}
