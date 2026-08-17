import { useEffect, useState } from "react";

/**
 * Reflects `value`, but only once it has stopped changing for `delayMs` —
 * the shared debounce for anything that would otherwise fire a request per
 * keystroke (Search's live query, issue #167). Every intermediate value is
 * dropped; only the final settled one is ever returned.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
