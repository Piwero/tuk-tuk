# The calendar time axis is piecewise; all minute↔pixel conversion goes through one mapping

## Status

Accepted

## Context

The Week and Day views of the Calendar lay entries out on a vertical time
grid: a minute of the day maps to a y offset in pixels. From the first
version of that grid this was a single global constant — `HOUR_PX = 48` —
and a linear scale: `y = (minute / 60) * HOUR_PX`, inverted the same way.
Six things came to depend on that one linear relationship:

- a block's `top` and `height`
- the create-drag, move-drag and resize gestures
- the arrow-key nudge on a resize handle
- the now-line's position
- where the grid scrolls to on open
- the minimum rendered block height (`HOUR_PX / 3`)

Issue #210 (Active hours) breaks the single scale. Inside the user's
active band the grid renders at 96px/hour so short tasks stay readable in
place; outside it, at 24px/hour so dead hours cost little scroll. The
minute→pixel relationship is now **piecewise**: three linear segments with
different slopes, meeting at the band edges.

A piecewise scale is unforgiving of code that assumes linearity. The
resize gesture is the sharp example: it computed a *delta* —
`((clientY - originY) / HOUR_PX) * 60` — and added it to the edge's start
minute. Under two slopes the same pixel travel is a different number of
minutes on each side of a boundary, so a block dragged across the band
edge detaches from the cursor and accumulates error that never washes out.

## Decision: one mapping, and everything routes through it

The axis is modelled as an ordered list of segments that tile
`[0, 1440]` gaplessly, each with its own px-per-minute slope
(`buildTimeAxis` in `frontend/oci/src/calendar.ts`). It exposes exactly
two conversion functions — `minuteToY` (a prefix sum over the segments)
and `yToMinute` (its inverse) — plus `blockHeight` for the scale-aware
minimum.

**Every** minute↔pixel conversion in the Calendar goes through these. The
grid renders its hour rows and its off-hours tint bands from the segment
list, not from 24 fixed-height rows. The now-line, the initial scroll
target, and every block's geometry call `minuteToY`. There is no surviving
`HOUR_PX` constant and no `(minute / 60) * something` anywhere in the
Calendar.

The drag gestures become **position-based, not delta-based**. A resize
maps the grabbed edge's absolute pixel position — its y at grab, plus the
pointer's travel since — back through `yToMinute`, so the edge tracks the
cursor across a band boundary exactly. Recomputing the slope per frame
from the block's *current* position was considered and rejected: it is a
smaller diff, but it drifts across boundaries and reintroduces precisely
the bug class this record exists to prevent.

With Active hours disabled the segment list is a single segment at
48px/hour, so the mapping is bit-for-bit the old linear scale and an
existing install's grid is unchanged.

## Considered options (and why they were rejected)

- **Keep the linear scale; make Active hours a pure CSS `transform` on the
  band.** Rejected — the drag math still reads real pixel coordinates off
  the DOM, so it would see the transformed geometry and the delta formula
  would still be wrong; and hit-testing hour cells would need the inverse
  transform anyway.
- **A single scale, but recompute it per gesture frame from the dragged
  block's position.** Rejected as above: drifts across boundaries.
- **Store the axis as a lookup table of 1440 entries.** Rejected as
  overkill — three segments and a prefix sum is exact, allocation-free,
  and trivially invertible.

## Accepted trade-offs

- Any new code that touches the time grid must reach for `minuteToY` /
  `yToMinute` rather than a constant. This ADR and the header comment on
  the axis section of `calendar.ts` are the only things stopping someone
  reintroducing `(min / 60) * HOUR_PX` and silently breaking drag
  behaviour — the invariant, not the feature, is what this record is for.
- The hour drop-cells can span a band boundary (a 09:30 band edge splits
  the 09:00 hour). They stay one-hour drop targets; the split is carried
  visually by the tint, not by cutting the cell.
- Only the **resize** gesture was rewritten position-based. Create-drag and
  move-drag were already cell-index based — they hit-test whole-hour DOM
  cells and resolve to an integer hour, never a pixel→minute conversion —
  so they are scale-independent as they stand and route through no mapping.
  The cost is that create and move keep whole-hour granularity inside a
  96px active hour; finer placement there is a resize away.

## What would justify revisiting this

A second feature that needs to warp the time axis (a fisheye around the
now-line, say) would still fit this model — more segments, same two
functions. What would break it is a non-monotonic or non-linear axis
(e.g. a logarithmic scale), which would make `yToMinute` ambiguous or
require a real solver; nothing on the roadmap points that way.
