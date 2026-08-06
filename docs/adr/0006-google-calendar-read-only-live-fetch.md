# Google Calendar integration: live, read-only

## Status

Accepted. Where the OAuth client credentials and the token-encryption key
are stored is superseded by [0008](0008-ui-managed-settings.md) —
`GOOGLE_CLIENT_ID`/`SECRET` move from `.env` into the database, managed
from the UI, and `GOOGLE_ENCRYPTION_KEY` is retired in favor of a single
root `APP_MASTER_KEY`. The read-only scope and live-fetch decisions below
are unaffected.

## Context

tuk-tuk's Calendar surfaces a user's Google Calendar Events alongside their
Tasks, and lets an Event be converted into a Task. Two shapes of this
integration are not evident from the code that results and are the ones
most likely to be questioned and quietly reversed by a future reader:
whether Events are mirrored into our own storage, and whether the
integration can write back to Google. Both are addressed here as one
record because they were decided together and each explains a consequence
of the other.

## Decision: Events are fetched live, not persisted

Google Events are fetched live from the Google Calendar API for the
visible window and cached only briefly in process. There is no Events
table, no incremental sync, and no local copy of a user's calendar data.

## Considered options (and why they were rejected)

- **Mirroring Events into a table with incremental sync, instead of live
  fetch.** Rejected — Google already expands recurring series into
  concrete instances for a requested window; mirroring discards that
  expansion and forces tuk-tuk to reimplement recurrence expansion itself,
  along with sync tokens, tombstones for deleted Events, and a class of
  staleness bugs where the mirror and Google disagree. tuk-tuk is a
  single-reader app — one person, one browser tab at a time — so the
  request volume that incremental sync exists to amortize doesn't apply
  here. A live fetch per visible window is proportional to the actual load.

## Accepted trade-offs

- The Calendar view depends on network reachability to Google: if Google
  Calendar's API is unreachable, the Calendar cannot show Events (Tasks are
  unaffected, since they are stored locally). There is no offline fallback.
- Events are invisible to anything that isn't the live Calendar view —
  Smart Lists, search, and statistics cannot see or aggregate over Events,
  because nothing about them is stored beyond the brief in-process cache.

## What would justify revisiting this

Wanting Events to appear in Smart Lists, search, or statistics; or wanting
the Calendar to keep working offline. Any of these needs a local copy of
Event data and therefore the sync machinery this decision rejects.

## Decision: access to Google is read-only

The integration requests a read-only OAuth scope. It can read a user's
Events but can never write to Google — no marking an Event converted, no
colour change, no description edit, nothing.

## Considered options (and why they were rejected)

- **A read-write scope, so a converted Event could be marked or annotated
  on the Google side.** Rejected — a bug in an actively-developed app must
  not be able to destroy or corrupt a real meeting on a user's actual
  calendar; a read-only integration cannot do that damage no matter what
  bugs it ships. Requesting write access "just in case" also means every
  already-connected account would need to re-consent when the scope
  widens, which is a cost paid by every user, not just the ones who'd
  benefit.

## Accepted trade-offs

- Because Google can never be told an Event was converted, "this Event has
  already been converted to a Task" must be remembered locally. This state
  hangs off the Task as provenance (which Event it came from), not off the
  Event, since no Event storage exists per the decision above.
- Any Google-side affordance that would require writing — marking,
  colouring, annotating, or deleting an Event from tuk-tuk — is
  permanently out of reach under this scope and would require the re-consent
  cost described above to add.

## What would justify revisiting this

A concrete need for tuk-tuk to change something on the Google side itself
(rather than merely reading it and recording state locally) — for example,
Google-side conflict marking, or two-way sync of an Event's fields. Since
widening the scope forces re-consent for every connected account, this
should only be revisited when that need is real, not speculative.
