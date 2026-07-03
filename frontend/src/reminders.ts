/** Reminder offsets: signed ISO-8601 durations relative to the task's date
 * (iCalendar TRIGGER convention: "PT0S" at time, "-PT30M" 30 minutes before).
 * Stored only — v1 delivers no notifications.
 */

export interface ReminderPreset {
  offset: string;
  label: string;
}

/** The quick choices offered by the detail panel, in menu order. */
export const REMINDER_PRESETS: ReminderPreset[] = [
  { offset: "PT0S", label: "At time of task" },
  { offset: "-PT30M", label: "30 minutes before" },
  { offset: "-PT1H", label: "1 hour before" },
  { offset: "-P1D", label: "1 day before" },
];

export type OffsetUnit = "minutes" | "hours" | "days";

const UNIT_SUFFIX: Record<OffsetUnit, (amount: number) => string> = {
  minutes: (amount) => `T${amount}M`,
  hours: (amount) => `T${amount}H`,
  days: (amount) => `${amount}D`,
};

/** Build an "N units before" offset; zero collapses to "at time of task". */
export function customOffset(amount: number, unit: OffsetUnit): string {
  return amount === 0 ? "PT0S" : `-P${UNIT_SUFFIX[unit](amount)}`;
}

const OFFSET_RE = /^(-?)P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

/** A readable label for an offset: "At time of task", "2 hours before", or the
 * raw string for shapes the UI never builds (positive or multi-unit offsets). */
export function reminderLabel(offset: string): string {
  const match = OFFSET_RE.exec(offset);
  if (match === null) {
    return offset;
  }
  const [, sign, days, hours, minutes, seconds] = match;
  const parts: Array<[number, string]> = [
    [Number(days ?? 0), "day"],
    [Number(hours ?? 0), "hour"],
    [Number(minutes ?? 0), "minute"],
    [Number(seconds ?? 0), "second"],
  ];
  const nonZero = parts.filter(([amount]) => amount > 0);
  if (nonZero.length === 0) {
    return "At time of task";
  }
  const only = nonZero.length === 1 ? nonZero[0] : undefined;
  if (only === undefined || sign !== "-") {
    return offset;
  }
  const [amount, unit] = only;
  return `${amount} ${unit}${amount === 1 ? "" : "s"} before`;
}
