import { useState } from "react";

import { ApiError, snoozeReminder, type ReminderDeliveryRead } from "../api";
import { localTimeOf } from "../dates";
import { reminderLabel } from "../reminders";
import { IconButton } from "./IconButton";
import "./DeliveredReminders.css";

/** A Reminder this tab delivered, as the in-app card shows it. */
export interface DeliveredReminder {
  id: number;
  task_id: number;
  task_title: string;
  offset: string;
}

/** The snooze choices, in order. Short delays only: a later time is a new
 * date, which the User sets on the Task itself. */
const SNOOZE_CHOICES = [
  { minutes: 10, label: "Snooze 10 minutes" },
  { minutes: 60, label: "Snooze 1 hour" },
] as const;

function snoozeErrorText(error: unknown): string {
  if (error instanceof ApiError && error.code === "reminder_stale") {
    return "This reminder can't be snoozed: its Task was completed, moved or changed.";
  }
  return "The snooze could not be saved. Try again.";
}

/** Snooze controls for one Reminder occurrence (issue #566). A snooze is
 * a delivery override: the Reminder notifies once more later, and the
 * Task's due date, start and Reminders never change, which the copy says
 * in words. `onSnooze` sends it: the ordinary snooze of a ledger row, or
 * the missed list's snooze of a Reminder no tab claimed. */
export function ReminderSnooze({
  onSnooze,
}: {
  onSnooze: (minutes: number) => Promise<ReminderDeliveryRead>;
}): React.JSX.Element {
  const [until, setUntil] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function snooze(minutes: number): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const row = await onSnooze(minutes);
      setUntil(row.snoozed_until ?? new Date(Date.now() + minutes * 60_000).toISOString());
    } catch (caught) {
      setError(snoozeErrorText(caught));
    } finally {
      setSaving(false);
    }
  }

  if (until !== null) {
    return (
      <p role="status" className="delivered-reminder-note">
        Snoozed until {localTimeOf(new Date(until))}. Deadline unchanged.
      </p>
    );
  }
  return (
    <>
      <p className="delivered-reminder-note">
        Snoozing delays only this alert. The deadline stays unchanged.
      </p>
      <div className="delivered-reminder-actions">
        {SNOOZE_CHOICES.map((choice) => (
          <button
            key={choice.minutes}
            type="button"
            className="btn-secondary"
            disabled={saving}
            onClick={() => void snooze(choice.minutes)}
          >
            {choice.label}
          </button>
        ))}
      </div>
      {error !== null && (
        <p role="alert" className="delivered-reminder-error">
          {error}
        </p>
      )}
    </>
  );
}

interface DeliveredRemindersProps {
  reminders: DeliveredReminder[];
  onOpenTask: (taskId: number) => void;
  onDismiss: (id: number) => void;
}

/** The delivered-reminder surface (issue #566): each Reminder this tab
 * showed as a system notification also stays here until dismissed, with
 * Open task and Snooze. A page notification can't carry buttons without
 * a Service Worker (ADR 0019), so the actions live in the app. */
export function DeliveredReminders({
  reminders,
  onOpenTask,
  onDismiss,
}: DeliveredRemindersProps): React.JSX.Element | null {
  if (reminders.length === 0) return null;
  return (
    <div className="delivered-reminders">
      {reminders.map((reminder) => (
        <section
          key={reminder.id}
          className="delivered-reminder"
          aria-label={`Reminder: ${reminder.task_title}`}
        >
          <div className="delivered-reminder-head">
            <div>
              <h2 className="delivered-reminder-title">{reminder.task_title}</h2>
              <p className="delivered-reminder-when">{reminderLabel(reminder.offset)}</p>
            </div>
            <IconButton
              icon="x"
              size={14}
              label="Dismiss reminder"
              className="delivered-reminder-dismiss"
              onClick={() => onDismiss(reminder.id)}
            />
          </div>
          <ReminderSnooze onSnooze={(minutes) => snoozeReminder(reminder.id, minutes)} />
          <button
            type="button"
            className="btn-quiet delivered-reminder-open"
            onClick={() => {
              onOpenTask(reminder.task_id);
              onDismiss(reminder.id);
            }}
          >
            Open task
          </button>
        </section>
      ))}
    </div>
  );
}
