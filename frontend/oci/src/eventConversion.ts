/** What "Convert to task" (issue #111) turns an Event into: the payload
 * `createTask` sends, plus enough to preview it truthfully before the user
 * confirms — conversion is never a surprise.
 */

import { type Event, type TaskCreateInput } from "./api";
import { browserTimeZone, instantOf, shortDayLabel, zonedDay, zonedTime } from "./dates";

export interface EventConversionDraft {
  input: TaskCreateInput;
  /** True when a timed Event crossed midnight in the viewer's timezone: the
   * schedule invariant (a timed Task stays within one calendar day) isn't
   * relaxed, so the due date clamps to the end of the start day instead. */
  clamped: boolean;
  /** The Event's true end, for the preview and folded into the description
   * when `clamped` is true; null otherwise. */
  trueEndLabel: string | null;
}

/** The latest a clamped Task's due date can land within its start day —
 * matched to the HH:MM granularity every date input in the app already uses. */
const CLAMP_TIME = "23:59";

function describe(event: Event, trueEndLabel: string | null): string {
  const parts: string[] = [];
  if (event.description !== null && event.description !== "") {
    parts.push(event.description);
  }
  if (event.location !== null && event.location !== "") {
    parts.push(`Location: ${event.location}`);
  }
  if (trueEndLabel !== null) {
    parts.push(`Originally ends: ${trueEndLabel}`);
  }
  parts.push(`Google Event: ${event.html_link}`);
  return parts.join("\n\n");
}

/** The Task "Convert to task" would create from this Event, and whether its
 * schedule had to clamp to fit the invariant a Task can't relax. */
export function draftTaskFromEvent(event: Event): EventConversionDraft {
  const zone = browserTimeZone();
  const provenance = {
    source_google_calendar_id: event.calendar_id,
    source_google_event_id: event.google_event_id,
  };
  if (event.is_all_day) {
    return {
      input: {
        ...provenance,
        title: event.title,
        start_date: event.start_date,
        due_date: event.due_date,
        is_all_day: true,
        time_zone: zone,
        description: describe(event, null),
      },
      clamped: false,
      trueEndLabel: null,
    };
  }
  const startDay = zonedDay(event.start_date, null);
  const dueDay = zonedDay(event.due_date, null);
  const clamped = startDay !== dueDay;
  const trueEndLabel = clamped
    ? `${shortDayLabel(dueDay)}, ${zonedTime(event.due_date, null)}`
    : null;
  return {
    input: {
      ...provenance,
      title: event.title,
      start_date: event.start_date,
      due_date: clamped ? instantOf(startDay, CLAMP_TIME) : event.due_date,
      is_all_day: false,
      time_zone: zone,
      description: describe(event, trueEndLabel),
    },
    clamped,
    trueEndLabel,
  };
}
