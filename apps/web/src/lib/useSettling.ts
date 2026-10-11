// useSettling (TECHNICAL_SPECS §12 <CollectionView>, M7): true while a card list is re-sorting, so the page shows
// skeleton cards instead of re-flowing live ones under the user's finger.
//
// Busy while `waiting` (e.g. the Suggested sort is waiting for its first scores; given up after `maxWaitMs` so the list
// never stays hidden), and for at least `minMs` after the order of the items changes (a sort or filter change, or new
// scores re-ranking the list). A change of `quietKey` (the search text) re-orders without a skeleton, so typing
// doesn't flicker; the first order after an empty list (initial load) doesn't count as a re-sort.
import * as React from "react";

export function useSettling(order: string, opts: { waiting: boolean; quietKey?: string; minMs?: number; maxWaitMs?: number }): boolean {
  const { waiting, quietKey = "", minMs = 150, maxWaitMs = 4000 } = opts;
  const [seen, setSeen] = React.useState({ order, quietKey });
  const [settling, setSettling] = React.useState(false);
  const [expired, setExpired] = React.useState(false);

  // Derived during render (React's "adjust state when a prop changes"), so the new order never paints first.
  if (seen.order !== order || seen.quietKey !== quietKey) {
    const resort = seen.quietKey === quietKey && seen.order !== "" && order !== "";
    setSeen({ order, quietKey });
    if (resort) setSettling(true);
  }
  if (!waiting && expired) setExpired(false);

  // Each further re-order while settling restarts the minimum.
  React.useEffect(() => {
    if (!settling) return;
    const t = setTimeout(() => setSettling(false), minMs);
    return () => clearTimeout(t);
  }, [settling, order, minMs]);

  React.useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => setExpired(true), maxWaitMs);
    return () => clearTimeout(t);
  }, [waiting, maxWaitMs]);

  return (waiting && !expired) || settling;
}
