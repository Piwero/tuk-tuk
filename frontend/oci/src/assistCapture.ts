/** Assisted Capture's shared display helpers (ADR 0005; issues #43, #44).
 *
 * The Assist parse endpoint returns raw wire values — an RRULE body, signed
 * ISO-8601 reminder offsets, a resolved due-date instant. Both Quick-Add
 * surfaces (the one-line bar and the Quick add dialog) turn those into the
 * same human-readable chips and, for the dialog, into a `DateDraft` its own
 * date controls can edit. Kept here so the two never drift. */

import { type AssistCaptureDraft, parseAssistCapture, type Tag, type TaskList } from "./api";
import { browserTimeZone, type DateDraft, emptyDraft, localDayOf, localTimeOf } from "./dates";

/** A client-enforced backstop on top of the backend's own parse timeout
 * (issue #43): Assist only ever adds value, never subtracts it, so a slow
 * or hung parse must never hold a Quick-Add submit beyond a couple of
 * seconds — it degrades to a plain save instead. */
export const PARSE_TIMEOUT_MS = 5000;

/** One Assisted Capture parse of `text` (the residual title, explicit
 * `#`/`~`/`!` tokens already stripped), with the client-enforced timeout
 * both Quick-Add surfaces share. Returns null on any failure, timeout, or
 * abort — the caller then degrades to a plain save, never an error. The
 * caller's own local day and browser timezone are what a relative phrase
 * ("tomorrow") resolves against, server-side. */
export async function parseCaptureWithTimeout(
  text: string,
  lists: TaskList[],
  tags: Tag[],
): Promise<AssistCaptureDraft | null> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), PARSE_TIMEOUT_MS);
  try {
    return await parseAssistCapture(
      {
        text,
        local_date: localDayOf(new Date()),
        time_zone: browserTimeZone(),
        list_names: lists.map((list) => list.name),
        tag_names: tags.map((tag) => tag.name),
      },
      controller.signal,
    );
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

const FREQ_LABELS: Record<string, string> = {
  DAILY: "daily",
  WEEKLY: "weekly",
  MONTHLY: "monthly",
  YEARLY: "yearly",
};

const FREQ_UNIT_PLURALS: Record<string, string> = {
  DAILY: "days",
  WEEKLY: "weeks",
  MONTHLY: "months",
  YEARLY: "years",
};

const BYDAY_LABELS: Record<string, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};

function dayOrdinalSuffix(day: number): string {
  if (day % 10 === 1 && day !== 11) return "st";
  if (day % 10 === 2 && day !== 12) return "nd";
  if (day % 10 === 3 && day !== 13) return "rd";
  return "th";
}

/** A human-readable label for the RRULE content Assisted Capture's own
 * recurrence-phrase resolver emits (app.recurrence_phrase); anything this
 * doesn't recognize falls back to the raw rule so the chip never goes
 * blank. */
export function formatRecurrenceRule(recurrence: string): string {
  const parts = Object.fromEntries(
    recurrence.split(";").map((part) => part.split("=") as [string, string]),
  );
  const freq = parts.FREQ;
  if (freq === undefined) {
    return recurrence;
  }
  if (parts.BYMONTHDAY !== undefined) {
    return `monthly on the ${parts.BYMONTHDAY}${dayOrdinalSuffix(Number(parts.BYMONTHDAY))}`;
  }
  if (parts.BYDAY !== undefined) {
    const days = parts.BYDAY.split(",")
      .map((code) => BYDAY_LABELS[code] ?? code)
      .join(", ");
    return `weekly on ${days}`;
  }
  if (parts.INTERVAL !== undefined) {
    return `every ${parts.INTERVAL} ${FREQ_UNIT_PLURALS[freq] ?? freq.toLowerCase()}`;
  }
  return FREQ_LABELS[freq] ?? freq.toLowerCase();
}

/** A human-readable label for a reminder's signed ISO-8601 duration offset
 * (the wire format Task.reminders already uses). Only the closed set
 * Assisted Capture's own reminder-phrase resolver ever emits is rendered
 * specially; anything else falls back to the raw offset so the chip never
 * goes blank. */
export function formatReminderOffset(offset: string): string {
  if (offset === "PT0S") {
    return "at the time";
  }
  const daysMatch = /^-P(\d+)D$/.exec(offset);
  if (daysMatch !== null) {
    const n = Number(daysMatch[1]);
    return n === 1 ? "1 day before" : `${n} days before`;
  }
  const hoursMatch = /^-PT(\d+)H$/.exec(offset);
  if (hoursMatch !== null) {
    const n = Number(hoursMatch[1]);
    return n === 1 ? "1 hour before" : `${n} hours before`;
  }
  const minutesMatch = /^-PT(\d+)M$/.exec(offset);
  if (minutesMatch !== null) {
    const n = Number(minutesMatch[1]);
    return n === 1 ? "1 minute before" : `${n} minutes before`;
  }
  return offset;
}

/** The `DateDraft` the Quick add dialog's own date controls should show for
 * an Assisted Capture suggestion — the dialog's editable equivalent of the
 * bar's read-only date chip. A dateless suggestion clears the draft; a
 * timed one is read in the browser's wall clock, matching how the dialog
 * writes every schedule (v1 always stores the browser timezone). */
export function dateDraftFromAssist(
  suggestion: Pick<AssistCaptureDraft, "due_date" | "is_all_day">,
): DateDraft {
  if (suggestion.due_date === null) {
    return emptyDraft();
  }
  if (suggestion.is_all_day) {
    return {
      allDay: true,
      startDay: "",
      dueDay: suggestion.due_date.slice(0, 10),
      startTime: "",
      dueTime: "",
    };
  }
  const due = new Date(suggestion.due_date);
  return {
    allDay: false,
    startDay: "",
    dueDay: localDayOf(due),
    startTime: "",
    dueTime: localTimeOf(due),
  };
}
