/** Recurrence rules: the RRULE subset the editor speaks — FREQ, INTERVAL,
 * BYDAY, COUNT, UNTIL — mirrored after TickTick's repeat options. The rule is
 * stored as RRULE content anchored at the task's due date; completing the
 * task advances its dates to the next occurrence (ADR 0003).
 */

export type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export type RecurrenceEnd =
  | { kind: "never" }
  | { kind: "until"; day: string } // YYYY-MM-DD, inclusive
  | { kind: "count"; times: number };

export interface Recurrence {
  freq: Freq;
  interval: number;
  /** Weekly rules only: the chosen weekdays (empty means the due date's weekday). */
  byday: Weekday[];
  end: RecurrenceEnd;
}

/** RRULE weekday order (WKST=MO, the iCalendar default). */
export const WEEKDAYS: Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};

/** The noun each frequency repeats by — labels and the editor's options. */
export const FREQ_NOUNS: Record<Freq, string> = {
  DAILY: "day",
  WEEKLY: "week",
  MONTHLY: "month",
  YEARLY: "year",
};

const FREQS = Object.keys(FREQ_NOUNS) as Freq[];

export function serializeRecurrence(recurrence: Recurrence): string {
  const parts = [`FREQ=${recurrence.freq}`];
  if (recurrence.interval > 1) {
    parts.push(`INTERVAL=${recurrence.interval}`);
  }
  if (recurrence.freq === "WEEKLY" && recurrence.byday.length > 0) {
    parts.push(`BYDAY=${recurrence.byday.join(",")}`);
  }
  if (recurrence.end.kind === "until") {
    // End of the chosen day, so occurrences on that day still count.
    parts.push(`UNTIL=${recurrence.end.day.replaceAll("-", "")}T235959`);
  }
  if (recurrence.end.kind === "count") {
    parts.push(`COUNT=${recurrence.end.times}`);
  }
  return parts.join(";");
}

const UNTIL_RE = /^(\d{4})(\d{2})(\d{2})(?:T\d{6}Z?)?$/;

/** Parse RRULE content back into editor state; null when the rule uses
 * anything beyond the subset the editor can faithfully re-serialize. */
export function parseRecurrence(rule: string): Recurrence | null {
  const recurrence: Recurrence = { freq: "DAILY", interval: 1, byday: [], end: { kind: "never" } };
  let hasFreq = false;
  for (const part of rule.split(";")) {
    const [key, value] = part.split("=");
    if (value === undefined) {
      return null;
    }
    if (key === "FREQ" && FREQS.includes(value as Freq)) {
      recurrence.freq = value as Freq;
      hasFreq = true;
    } else if (key === "INTERVAL" && /^\d+$/.test(value)) {
      recurrence.interval = Number(value);
    } else if (key === "BYDAY") {
      const days = value.split(",");
      if (!days.every((day) => WEEKDAYS.includes(day as Weekday))) {
        return null;
      }
      recurrence.byday = days as Weekday[];
    } else if (key === "UNTIL") {
      const match = UNTIL_RE.exec(value);
      if (match === null) {
        return null;
      }
      recurrence.end = { kind: "until", day: `${match[1]}-${match[2]}-${match[3]}` };
    } else if (key === "COUNT" && /^\d+$/.test(value)) {
      recurrence.end = { kind: "count", times: Number(value) };
    } else {
      return null;
    }
  }
  return hasFreq ? recurrence : null;
}

/** A readable label: "Every day", "Every 2 weeks on Mon, Thu — ends after
 * 5 times". Rules beyond the editor's subset fall back to the raw string. */
export function recurrenceLabel(rule: string): string {
  const recurrence = parseRecurrence(rule);
  if (recurrence === null) {
    return rule;
  }
  const noun = FREQ_NOUNS[recurrence.freq];
  let text = recurrence.interval === 1 ? `Every ${noun}` : `Every ${recurrence.interval} ${noun}s`;
  if (recurrence.freq === "WEEKLY" && recurrence.byday.length > 0) {
    text += ` on ${recurrence.byday.map((day) => WEEKDAY_LABELS[day]).join(", ")}`;
  }
  if (recurrence.end.kind === "until") {
    text += ` — until ${recurrence.end.day}`;
  }
  if (recurrence.end.kind === "count") {
    text += ` — ends after ${recurrence.end.times} time${recurrence.end.times === 1 ? "" : "s"}`;
  }
  return text;
}
