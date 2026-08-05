# Google Calendar: per-account failure isolation and freshness

## Status

Accepted

## Context

ADR 0006 committed Events to being fetched live from Google, never
persisted — which means the Calendar view's correctness depends on Google
being reachable at read time. Two consequences of that follow directly and
are recorded together here because they were decided together: what
happens when Google isn't reachable for some (but not all) of a user's
connected accounts, and how the Calendar stays fresh without either
hammering Google or feeling stale.

## Decision: one account's failure is isolated and classified, never silent

Each connected Google Account's Events are read independently. A failure
reading one account's Events never blanks Events from the other connected
accounts — they still render, and an inline banner names the account that
failed. Silently showing fewer Events than exist is treated as the one
unacceptable outcome, since a user acting on an incomplete Calendar
double-books with no signal anything went wrong.

Every failure is classified as one of exactly two kinds before it reaches
the caller (`TransientCalendarSourceError` / `TerminalCalendarSourceError`
in `app.calendar_source`): transient (network trouble, a server error, rate
limiting) offers Retry and leaves the account connected; terminal (the
grant has been revoked or expired) flips the account's `connection_state`
to `needs_reconnect` and offers Reconnect instead, surfaced identically in
the Calendar banner and in Settings. A transient failure can never be
retried into success by itself if it's actually a revoked grant, and a
terminal failure will never be fixed by retrying — the two need different
affordances, not a single generic "something went wrong."

## Considered options (and why they were rejected)

- **One flat error for any Google failure**, leaving the caller to guess
  whether retrying could ever work. Rejected — before this decision,
  `CalendarSourceError` was raised for both a revoked refresh token and a
  transient 5xx alike; a caller had no way to offer the right affordance,
  and a Retry button behind a revoked grant can never succeed.
- **Blanking the whole Calendar on any Google failure** (the behaviour
  before this decision: a single `.catch(() => setEvents([]))` at the
  Calendar view's fetch). Rejected outright per the acceptance criteria
  above — it fails the one thing this integration cannot get wrong.

## Decision: freshness via window-change and focus refetch, plus a short in-process cache

Events refetch when the visible calendar window changes and when the
browser tab regains focus — the moment a user is most likely returning
from Google Calendar or their mail with a real change to see. A
short-lived cache directly in front of `CalendarSource.list_events`
(`app.event_cache.EventCache`, keyed on the exact calendar and window)
absorbs rapid navigation — paging quickly back and forth through months —
without re-reading Google on every render, while staying inside ADR 0006's
"cached only briefly in process" commitment: it is a cache in front of a
live read, never a second source of truth. A manual refresh control in the
Calendar toolbar bypasses the cache on demand and doubles as the Retry
affordance for a failed account, so staleness and failure recovery share
one control instead of two.

## Considered options (and why they were rejected)

- **Polling on an interval.** Rejected — tuk-tuk is a single-reader app
  that idles in a background tab far more than it's actively watched;
  polling on a schedule that's tight enough to feel fresh while the tab is
  open wastes almost all of its requests while it isn't.
- **Google's push notification channels** (webhook-based change
  notifications). Rejected as disproportionate — they require a publicly
  reachable endpoint, channel renewal bookkeeping, and per-account
  subscription management, all to solve a freshness problem that
  window-change and focus refetch already solve for how this app is
  actually used.

## Accepted trade-offs

- A change made directly in Google Calendar while the tab stays focused
  and the visible window stays the same will not appear until the cache
  entry expires or the manual refresh control is used.
- The cache is in-process and unkeyed by anything beyond calendar id and
  window: it is not shared across server processes and does not survive a
  restart. This matches tuk-tuk's single-reader, single-process deployment
  shape; it would need to become a shared cache (or be removed in favour of
  a shorter TTL) if that shape changed.

## What would justify revisiting this

Running multiple backend processes or instances behind a load balancer,
which would make the in-process cache inconsistent between requests; or a
user need for near-real-time reflection of external Google Calendar edits,
which would justify the push-channel cost this decision rejects.
