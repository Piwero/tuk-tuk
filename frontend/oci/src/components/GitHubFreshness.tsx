import { useEffect, useState } from "react";

/** "fetched 42 s ago", "fetched 3 min ago", "fetched 2 h ago". */
export function formatFetchedAgo(fetchedAt: Date, now: Date): string {
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
 * GitHub, which the backend caches for a minute. */
export function GitHubFreshness({ fetchedAt }: { fetchedAt: string }): React.JSX.Element {
  const now = useNow();
  return (
    <div className="github-freshness">
      <time dateTime={fetchedAt}>{formatFetchedAgo(new Date(fetchedAt), now)}</time>
    </div>
  );
}
