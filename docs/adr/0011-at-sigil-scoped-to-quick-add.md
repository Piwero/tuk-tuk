# The `@` schedule sigil: Quick-Add + Command Palette, not Calendar

The `@day` / `@time` capture sigil (issues #211–#214) is wired into the
Quick-Add bar, the Quick-Add dialog, **and** the Command Palette's "New
task" row. The Calendar view's inline task-draft — the one remaining
`TokenInput` consumer — deliberately does **not** parse `@`: a typed
`@tomorrow` there stays in the saved title verbatim.

`parseQuickAdd` gates this: `@` tokens only resolve when the caller passes
`now`. The three capture surfaces pass it; the calendar draft does not.

## History

The original decision (recorded here) scoped `@` to the two Quick-Add
surfaces only and kept it out of the palette, on the reasoning that the
palette is a keyboard-first navigation surface and capture there is a
convenience that borrows `#tag` / `!priority` / `~list`, not a second full
composer. A typed `@tomorrow` was judged "harmless, not misleading" — it
showed back in the title chip as literal text.

**Reversed.** In practice users type `@` in the palette expecting the same
dropdown the Quick-Add bar gives them, and nothing on the surface signals
that this one sigil is inert here while the other three work. "Harmless"
literal text is still a dead keystroke against a clear expectation, and
the Quick-Add bar being "one keystroke away" assumes the user knows that —
the palette is often the surface they reached for precisely because they
did not want to think about where the capture bar is.

The cost of wiring it in turned out small: one `dateChannel` on the
`TokenInput` (a straight copy of the Quick-Add bar's), `now` threaded into
`planPaletteCapture` (frozen once per palette open via `useState`), and a
`schedule` field kept as a sibling of `commit` on the `CapturePlan` so the
`createTask` payload shape is unchanged. `resolveTokenSchedule` — already
shared by both Quick-Add surfaces — does the day/time composition, so a
picked `@friday` chip plus a typed `@9am` compose exactly as they do in
the bar.

## Command Palette (current behaviour)

The palette's "New task" row parses `@` through the same
`resolveTokenSchedule` path as the Quick-Add bar. A resolved schedule
shows as a `date-chip` in the capture preview and is stamped on the
created Task via `due_date` / `is_all_day` / `time_zone`. An unresolvable
`@token` (`@bob`) is still left in the title verbatim — the closed `@`
vocabulary means only real day/time tokens are consumed.

## Calendar view (unchanged)

The Calendar draft is anchored to the day (and, in Week/Day view, the time
slot) the user clicked — `submitDraft` builds the create payload from
`draft.day` and the dragged minutes. It *inherently* carries a schedule. A
typed `@friday` would either be ignored (confusing) or override the slot
the user just clicked (worse — it fights the direct-manipulation gesture
that opened the draft). There is no coherent meaning for `@` here, so the
draft input does not parse it: `parseQuickAdd` runs without `now`, an
`@friday` typed out of Quick-Add habit lands as literal title text, and
the Task is still created on the clicked day.

## Decision

`@` is wired into all three capture surfaces (both Quick-Add surfaces and
the Command Palette "New task" row). The Calendar draft keeps passing
`parseQuickAdd` without `now`; an unresolved `@token` is literal title
text there, which is the safe behaviour for a surface that already owns
the schedule.

Tests in `paletteCapture.test.ts` and `App.paletteCapture.test.tsx` pin
the palette's resolve-and-strip behaviour; `App.calendar.test.tsx` pins
the calendar draft's literal-title behaviour so a future `TokenInput`
change cannot silently start consuming `@` there.

Considered and rejected: wiring `@` into the calendar draft (rejected —
the draft already has a date from the click; a second, conflicting source
of truth for the schedule).

## Consequences

- New `TokenInput` consumers still do not get `@` for free; a surface that
  wants scheduled capture must pass `now` into `parseQuickAdd` and handle
  the resulting `due` chip, as the three capture surfaces do.
- The palette "New task" row is now a scheduled-capture path. If it ever
  grows a richer inline date control, `@` filling it should follow the
  "fill an existing control, do not add a chip" pattern the Quick-Add
  dialog uses rather than the chip pattern the bar and palette use today.
