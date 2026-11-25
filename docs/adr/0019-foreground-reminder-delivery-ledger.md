# Foreground Reminder delivery through a claimed ledger

## Status

Accepted. Spec: issue #535; ticket #561. Builds on the opt-in of #557
(`user_settings.reminder_notifications_enabled`) and on the row-level
isolation of [0018](0018-multi-user-row-level-isolation.md).

## Context

Reminders were stored offsets with no delivery. Phase 3 delivers them, with
honest limits: only first-party browser notifications, no email, SMS or
third-party push service, and no promise beyond what a page can do. The
deployment is one backend pod (`replicas: 1`) and there is no worker
process. A User may have several tabs open at once, on one device or many,
and each tab would otherwise show the same Reminder.

## Decision

**Channel and scope.** A signed-in tab shows Reminders with the page-level
`new Notification()` while it is open, on a supported browser, from a
secure context. Delivery is foreground only. There is no Service Worker and
no Web Push: a closed tab, a closed browser or a locked device gets
nothing. Browsers without the page-level constructor (Android Chrome
requires `ServiceWorkerRegistration.showNotification`) are unsupported; the
tab reports the attempt as failed.

**The tab asks; the server decides.** No process wakes up when a Reminder
falls due. Each tab where delivery is allowed (the User's opt-in plus
browser permission) calls `POST /api/v1/reminder-deliveries/claim?tz=…`
when it starts, every 30 seconds, and when it becomes visible again. The
claim reloads the User's open Tasks, works out which Reminders are due, and
hands back a lease on each one that no other tab holds.

**Due.** A Reminder belongs to the Task's current occurrence: its current
due date. It fires at that anchor plus its offset. A timed Task anchors at
its due instant, and whole days are nominal in the Task's zone, so "1 day
before" 09:00 stays 09:00 across a DST change. An all-day Task anchors at
the start of its date in the claiming tab's zone (`tz`), since its date has
no hour. A Reminder can be claimed from its fire time for 5 minutes (the
delivery window). After that it is missed. It is never replayed as a late
alert; missed Reminders are listed in-app instead (#565).

**Stale work never notifies.** Every claim reads Tasks fresh. A completed
or deleted Task, a Reminder removed since, or a recurring Task advanced
past the occurrence ([ADR 0003](0003-recurring-task-advances-in-place.md))
yields no candidate. That holds even for an earlier claim whose lease is
still unreported. Deleting a Task deletes its ledger rows.

**Ledger.** `reminder_deliveries` is an owned table (ADR 0018), one row per
Reminder per occurrence: `task_id`, `offset`, `occurrence_due`, `fire_at`,
`state` (`claimed`, `shown`, `failed`), `attempts`, `lease_token`,
`lease_expires_at`, `claimed_at` and `reported_at`. A unique key on
`(task_id, offset, occurrence_due)` deduplicates delivery. Two tabs
claiming at the same moment both try to insert the row, PostgreSQL lets
exactly one succeed, and the other tab skips it.

**Lease and retry policy.** A claim is a 60-second lease. The tab shows the
notification and reports `POST …/{id}/shown` (the browser fired `show`) or
`…/failed` (it threw or fired `error`), passing its `lease_token`. If the
lease expires unreported because the tab crashed or closed, the next claim
from any tab takes it over with a new token. That happens at most 3 claims
in all, and only inside the delivery window. A report carrying an
overwritten token gets `409 lease_lost`. A late report whose token is still
current is accepted. `failed` is final, since a refusing browser would
refuse again. Repeating a report changes nothing. Each notification's
`tag` is its ledger row, so a retry on the same device replaces the earlier
alert instead of stacking on it.

**Who may claim.** Claims and reports need a live session, and the
existing middleware turns away a logged-out, expired or disabled User with
`401`. Nothing is claimed while the User's opt-in is off, even when the
browser still holds permission. Every ledger read and write is filtered to
the User's own rows, so another User's ids get `404`. Tasks are only ever
read through the same filter.

**Click.** Clicking a notification focuses the tab, closes the
notification and opens its Task's detail. Check Items carry no Reminders.

**Quiet hours (#567).** A User may set Quiet hours
(`GET`/`PUT /api/v1/settings/quiet-hours` with `{enabled, start, end}`,
off by default, 22:00–07:00). They are a notification setting only. Active
hours ([ADR 0010](0010-calendar-piecewise-time-axis.md)) stay a Calendar
layout band, and the claim never reads them.

- The band is two `HH:MM` wall-clock labels, read in the claiming tab's
  zone (`tz`), the same zone that anchors all-day Tasks. It may wrap past
  midnight: a start after the end ends the next day. A start equal to its
  end is refused with `422 invalid_quiet_hours`, as is a label that is not
  a time of day. The start is inside the band and the end is not.
- A Reminder whose fire time falls inside the band is held. Its delivery
  time (`deliver_at`) becomes the end of that band. Its delivery window
  opens there instead of at the fire time, and `fire_at` itself never
  changes. One helper, `reminder_delivery.deliver_at`, decides the delivery
  time. A snooze override (#566) belongs there too.
- Nothing is claimed while `now` is inside the band. A Reminder that fired
  just before the band and was not claimed by then is missed, not held.
- Held Reminders keep the same ledger key `(task_id, offset,
  occurrence_due)`, so several tabs coming out of Quiet hours together
  still notify once. Rows are written only when claimed, at the band's end.
- The claim response adds `held` (the Reminders that already fired and are
  waiting, soonest first, each with `fire_at` and `deliver_at`) and
  `quiet_until` (the end of the band holding `now`, or `null`). The app
  lists `held` in a "Quiet hours deferred" panel while the band is on.
- Turning Quiet hours off does not release held Reminders as late alerts.
  Each one falls back to its own window, which has usually passed.

## Consequences

- Exactly-once display is not promised. A tab that crashes after the
  browser showed the alert but before it reported `shown` gets that
  Reminder retried, and it can appear twice. A browser that never fires
  `show` causes the same retry. In the other direction, `shown` only means
  the browser said so. It is never proof that the operating system
  displayed anything.
- Precision depends on the poll. A Reminder shows up to about 30 seconds
  late, more in a background tab whose timers the browser throttles. The
  5-minute window absorbs a once-a-minute throttle.
- The claim reads all of the User's open, dated Tasks each time, because
  offsets are unbounded and live in a JSON column. That is fine for one
  person's Task list on a single pod, and it should be revisited if lists
  grow large.
- Nothing here needs a second replica or a worker. The ledger is correct
  across several backend processes too, because it relies only on the
  database's unique index and row locks.
- Snooze (#566) and Quiet hours (#567) extend the rule that decides when a
  ledger row is due. Missed reminders (#565) read Reminders whose window
  passed without a `shown` row. None of them change the lease protocol.
- Background or closed-app delivery would need Web Push and a Service
  Worker, verified per browser. That is a separate decision, not part of
  this one.
