# The `@` schedule sigil is scoped to the two Quick-Add surfaces

The `@day` / `@time` capture sigil (issues #211–#214) is wired only into
the Quick-Add bar and the Quick-Add dialog. The two other `TokenInput`
consumers — the Command Palette's "New task" row and the Calendar view's
inline task-draft — deliberately do **not** parse `@`. A typed `@tomorrow`
in either of them stays in the saved title verbatim, exactly as it did
before the sigil existed.

`parseQuickAdd` already encodes this: `@` tokens only resolve when the
caller passes `now`, and neither surface does. This ADR records why that
stays the case rather than being an oversight to fix later.

## Command Palette

The palette's "New task" row is a real task-creation path — it calls
`createTask` with the `planPaletteCapture` payload. But it has no date
control, and adding one is the wrong direction for this surface. The
palette is a keyboard-first *navigation and command* surface; capture is a
convenience that borrows the `#tag` / `!priority` / `~list` shortcuts, not
a second full composer. Wiring `@` would mean a schedule chip in the
preview, a reschedule-on-create call, and `now` plumbed through
`planPaletteCapture` — scope the palette does not need when the Quick-Add
bar (also reachable without the pointer) is one keystroke away and owns
scheduling.

A typed `@tomorrow` here is **harmless, not misleading**: `parseQuickAdd`
runs without `now`, so the token is left in the stripped title and shows
back to the user *in the title chip* of the capture preview ("Buy milk
@tomorrow") — no date chip appears, nothing claims to be scheduled, and
the task is created with that literal title and no `due_date`. The user
sees exactly what they will get.

## Calendar view

The Calendar draft is anchored to the day (and, in Week/Day view, the time
slot) the user clicked — `submitDraft` builds the create payload from
`draft.day` and the dragged minutes. It *inherently* carries a schedule. A
typed `@friday` would either be ignored (confusing) or override the slot
the user just clicked (worse — it fights the direct-manipulation gesture
that opened the draft). There is no coherent meaning for `@` here, so the
draft input does not parse it.

As in the palette, `parseQuickAdd` runs without `now`, so an `@friday`
that a user types out of Quick-Add habit lands as literal text in the
title and the task is still created on the clicked day. Harmless.

## Decision

`@` stays a Quick-Add feature. The palette and calendar drafts keep
passing `parseQuickAdd` without `now`; an unresolved `@token` is literal
title text in both, which is the safe and already-current behaviour.
Tests in `paletteCapture.test.ts`, `App.paletteCapture.test.tsx` and
`App.calendar.test.tsx` pin that literal-title behaviour so a future
`TokenInput` change cannot silently start consuming `@` on these surfaces.

Considered and rejected: wiring `@` into the palette "New task" row
(rejected — pushes the palette toward being a second composer for a
convenience path, when the Quick-Add bar already covers keyboard-only
scheduled capture); wiring `@` into the calendar draft (rejected — the
draft already has a date from the click; a second, conflicting source of
truth for the schedule).

## Consequences

- New `TokenInput` consumers do not get `@` for free; a surface that wants
  scheduled capture must pass `now` into `parseQuickAdd` and handle the
  resulting `due` chip, as the Quick-Add surfaces do.
- If the palette ever grows a genuine inline date control, revisit — at
  that point `@` filling it would match the "fill an existing control, do
  not add a chip" pattern the Quick-Add dialog follows.
