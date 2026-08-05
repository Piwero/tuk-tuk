import { type Event } from "../api";
import { eventAttendees } from "../calendar";
import { formatSchedule } from "../dates";

interface EventDetailProps {
  event: Event;
}

/** The read-only content of an Event's detail popover (issue #110) — the
 * only place tuk-tuk shows an Event's attendees, organiser, or full
 * description (a video-call link is often buried in the latter), and the
 * only affordance that opens it in Google Calendar. Wrapped in `Modal` by
 * the caller, exactly like QuickAddDialog: dismissing it changes nothing,
 * since nothing here writes anywhere. */
export function EventDetail({ event }: EventDetailProps): JSX.Element {
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
    </div>
  );
}
