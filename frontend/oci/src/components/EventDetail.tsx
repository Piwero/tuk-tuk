import { useState } from "react";

import { createTask, type Event, type Task } from "../api";
import { eventAttendees } from "../calendar";
import { formatSchedule } from "../dates";
import { draftTaskFromEvent } from "../eventConversion";

interface EventDetailProps {
  event: Event;
  /** Called once the Task exists, with the Task itself (issue #111). */
  onConverted: (task: Task) => void;
}

/** The read-only content of an Event's detail popover (issue #110) — the
 * only place tuk-tuk shows an Event's attendees, organiser, or full
 * description (a video-call link is often buried in the latter), and the
 * only affordance that opens it in Google Calendar. Wrapped in `Modal` by
 * the caller, exactly like QuickAddDialog: dismissing it changes nothing,
 * since nothing here writes anywhere — except "Convert to task" (issue
 * #111), which shows exactly what it will create before it ever does. */
export function EventDetail({ event, onConverted }: EventDetailProps): JSX.Element {
  const [converting, setConverting] = useState(false);

  if (converting) {
    return (
      <ConvertPreview
        event={event}
        onCancel={() => setConverting(false)}
        onConverted={onConverted}
      />
    );
  }

  const attendees = eventAttendees(event);

  return (
    <div className="event-detail">
      <div className="event-detail-row">
        <span className="event-detail-label">When</span>
        <span>{formatSchedule(event)}</span>
      </div>
      {event.location !== null && event.location !== "" && (
        <div className="event-detail-row">
          <span className="event-detail-label">Location</span>
          <span>{event.location}</span>
        </div>
      )}
      {attendees.length > 0 && (
        <div className="event-detail-row">
          <span className="event-detail-label">Attendees</span>
          <ul className="event-detail-attendees">
            {attendees.map((attendee) => (
              <li key={attendee.email}>
                {attendee.display_name ?? attendee.email}
                {event.organizer?.email === attendee.email && " (organiser)"}
              </li>
            ))}
          </ul>
        </div>
      )}
      {event.description !== null && event.description !== "" && (
        <div className="event-detail-row">
          <span className="event-detail-label">Description</span>
          <p className="event-detail-description">{event.description}</p>
        </div>
      )}
      <div className="event-detail-row">
        <span className="event-detail-label">From</span>
        <span>
          {event.calendar_summary} &middot; {event.account_email}
        </span>
      </div>
      {event.html_link !== "" && (
        <a
          className="event-detail-link"
          href={event.html_link}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open in Google Calendar
        </a>
      )}
      <div className="event-detail-actions">
        <button type="button" onClick={() => setConverting(true)}>
          Convert to task
        </button>
      </div>
    </div>
  );
}

interface ConvertPreviewProps {
  event: Event;
  onCancel: () => void;
  onConverted: (task: Task) => void;
}

/** What "Convert to task" shows before it commits (issue #111): exactly the
 * Task it's about to create, so conversion is never a surprise. Cancelling
 * here has done nothing — the Task doesn't exist until Confirm. */
function ConvertPreview({ event, onCancel, onConverted }: ConvertPreviewProps): JSX.Element {
  const draft = draftTaskFromEvent(event);
  const { input } = draft;

  async function confirm(): Promise<void> {
    const task = await createTask(input);
    onConverted(task);
  }

  return (
    <div className="event-detail event-convert-preview">
      <p className="event-convert-intro">This Event will become a Task:</p>
      <div className="event-detail-row">
        <span className="event-detail-label">Title</span>
        <span>{input.title}</span>
      </div>
      <div className="event-detail-row">
        <span className="event-detail-label">When</span>
        <span>
          {formatSchedule({
            start_date: input.start_date ?? null,
            due_date: input.due_date ?? null,
            is_all_day: input.is_all_day ?? false,
          })}
        </span>
      </div>
      {draft.clamped && (
        <p className="event-convert-clamp">
          This crosses midnight: a Task can't span two days, so it runs until 23:59 that day.
          Originally ends: {draft.trueEndLabel}.
        </p>
      )}
      {input.description !== undefined && input.description !== "" && (
        <div className="event-detail-row">
          <span className="event-detail-label">Description</span>
          <p className="event-detail-description">{input.description}</p>
        </div>
      )}
      <div className="event-convert-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="event-convert-confirm" onClick={() => void confirm()}>
          Confirm
        </button>
      </div>
    </div>
  );
}
