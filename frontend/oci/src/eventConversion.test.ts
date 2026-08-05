import { describe, expect, it } from "vitest";

import { type Event } from "./api";
import { draftTaskFromEvent } from "./eventConversion";

function event(overrides: Partial<Event> = {}): Event {
  return {
    id: "1:evt-1",
    title: "Standup",
    start_date: "2026-07-10T13:00:00Z",
    due_date: "2026-07-10T13:30:00Z",
    is_all_day: false,
    color: "#4772fa",
    location: null,
    description: null,
    attendees: [],
    organizer: null,
    html_link: "https://calendar.google.com/calendar/event?eid=fake",
    account_email: "me@example.com",
    calendar_summary: "Work",
    calendar_id: 1,
    google_event_id: "evt-1",
    ...overrides,
  };
}

describe("draftTaskFromEvent (issue #111)", () => {
  it("carries the title and exact schedule for a same-day timed Event", () => {
    const draft = draftTaskFromEvent(event());

    expect(draft.input.title).toBe("Standup");
    expect(draft.input.start_date).toBe("2026-07-10T13:00:00Z");
    expect(draft.input.due_date).toBe("2026-07-10T13:30:00Z");
    expect(draft.input.is_all_day).toBe(false);
    expect(draft.input.time_zone).toBe("UTC");
    expect(draft.clamped).toBe(false);
    expect(draft.trueEndLabel).toBeNull();
  });

  it("carries the Event's provenance for later hiding", () => {
    const draft = draftTaskFromEvent(event({ calendar_id: 7, google_event_id: "evt-9" }));

    expect(draft.input.source_google_calendar_id).toBe(7);
    expect(draft.input.source_google_event_id).toBe("evt-9");
  });

  it("carries an all-day Event's exact day span", () => {
    const draft = draftTaskFromEvent(
      event({
        is_all_day: true,
        start_date: "2026-07-10T00:00:00Z",
        due_date: "2026-07-12T00:00:00Z",
      }),
    );

    expect(draft.input.is_all_day).toBe(true);
    expect(draft.input.start_date).toBe("2026-07-10T00:00:00Z");
    expect(draft.input.due_date).toBe("2026-07-12T00:00:00Z");
    expect(draft.clamped).toBe(false);
  });

  it("clamps a midnight-crossing timed Event to the end of its start day", () => {
    const draft = draftTaskFromEvent(
      event({ start_date: "2026-07-10T23:00:00Z", due_date: "2026-07-11T00:45:00Z" }),
    );

    expect(draft.input.start_date).toBe("2026-07-10T23:00:00Z");
    expect(draft.input.due_date).toBe("2026-07-10T23:59:00.000Z");
    expect(draft.clamped).toBe(true);
    expect(draft.trueEndLabel).toContain("00:45");
  });

  it("does not clamp a timed Event that stays within one day", () => {
    const draft = draftTaskFromEvent(
      event({ start_date: "2026-07-10T09:00:00Z", due_date: "2026-07-10T17:00:00Z" }),
    );

    expect(draft.clamped).toBe(false);
    expect(draft.input.due_date).toBe("2026-07-10T17:00:00Z");
  });

  it("folds the Event's description and location into the Task's, with a link back", () => {
    const draft = draftTaskFromEvent(
      event({ description: "Daily sync notes", location: "Room 4B" }),
    );

    expect(draft.input.description).toBe(
      "Daily sync notes\n\nLocation: Room 4B\n\nGoogle Event: https://calendar.google.com/calendar/event?eid=fake",
    );
  });

  it("still links back to the Event when it has no description or location", () => {
    const draft = draftTaskFromEvent(event());

    expect(draft.input.description).toBe(
      "Google Event: https://calendar.google.com/calendar/event?eid=fake",
    );
  });

  it("notes the clamp and the true end time in the description", () => {
    const draft = draftTaskFromEvent(
      event({ start_date: "2026-07-10T23:00:00Z", due_date: "2026-07-11T00:45:00Z" }),
    );

    expect(draft.input.description).toContain("Originally ends:");
    expect(draft.input.description).toContain("Google Event:");
  });
});
