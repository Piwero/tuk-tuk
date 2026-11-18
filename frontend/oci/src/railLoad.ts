import { useCallback, useEffect, useState } from "react";

/** One card's load lifecycle. Each card owns its own, so one failing card
 * shows its own retry and never touches Today's Tasks or its sibling cards. */
export type RailLoad<T> =
  { status: "loading" } | { status: "error" } | { status: "ready"; data: T };

/** Loads a card's data on mount, and again whenever `load` changes identity
 * (a card can refresh by passing a new callback); `retry` reloads after a failure. */
export function useRailLoad<T>(load: () => Promise<T>): {
  state: RailLoad<T>;
  retry: () => void;
} {
  const [state, setState] = useState<RailLoad<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    load().then(
      (data) => {
        if (!cancelled) setState({ status: "ready", data });
      },
      () => {
        if (!cancelled) setState({ status: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [load, attempt]);
  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);
  return { state, retry };
}
