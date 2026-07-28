import { type DateDraft } from "../dates";

interface DateFieldsetProps {
  draft: DateDraft;
  onChange: (draft: DateDraft) => void;
}

/** The date editor's inputs, shared by the task detail panel and the Quick add
 * dialog: an all-day span of days, or a timed start+due within one day.
 *
 * Purely a draft editor — validating and saving belongs to the owner, which is
 * why the two callers can wrap it in a Save button or a whole create form. */
export function DateFieldset({ draft, onChange }: DateFieldsetProps): JSX.Element {
  return (
    <div className="date-editor">
      <label>
        <input
          type="checkbox"
          aria-label="All day"
          checked={draft.allDay}
          onChange={(event) => onChange({ ...draft, allDay: event.target.checked })}
        />
        All day
      </label>
      {draft.allDay ? (
        <>
          <label>
            Start day
            <input
              type="date"
              value={draft.startDay}
              onChange={(event) => onChange({ ...draft, startDay: event.target.value })}
            />
          </label>
          <label>
            Due day
            <input
              type="date"
              value={draft.dueDay}
              onChange={(event) => onChange({ ...draft, dueDay: event.target.value })}
            />
          </label>
        </>
      ) : (
        <>
          <label>
            Day
            <input
              type="date"
              value={draft.dueDay}
              onChange={(event) => onChange({ ...draft, dueDay: event.target.value })}
            />
          </label>
          <label>
            Start time
            <input
              type="time"
              value={draft.startTime}
              onChange={(event) => onChange({ ...draft, startTime: event.target.value })}
            />
          </label>
          <label>
            Due time
            <input
              type="time"
              value={draft.dueTime}
              onChange={(event) => onChange({ ...draft, dueTime: event.target.value })}
            />
          </label>
        </>
      )}
    </div>
  );
}
