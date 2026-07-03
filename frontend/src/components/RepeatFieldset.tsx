import { useEffect, useState } from "react";

import { updateTask, type Task } from "../api";
import {
  FREQ_NOUNS,
  parseRecurrence,
  recurrenceLabel,
  serializeRecurrence,
  WEEKDAY_LABELS,
  WEEKDAYS,
  type Freq,
  type Weekday,
} from "../recurrence";

interface RepeatFieldsetProps {
  task: Task;
  onTaskChanged: (task: Task) => void;
}

/** Draft state of the custom repeat editor; numbers stay strings while typing. */
interface RepeatDraft {
  freq: Freq;
  interval: string;
  byday: Weekday[];
  endKind: "never" | "until" | "count";
  untilDay: string;
  times: string;
}

function repeatDraftFrom(rule: string | null): RepeatDraft {
  const parsed = rule === null ? null : parseRecurrence(rule);
  return {
    freq: parsed?.freq ?? "DAILY",
    interval: String(parsed?.interval ?? 1),
    byday: parsed?.byday ?? [],
    endKind: parsed?.end.kind ?? "never",
    untilDay: parsed?.end.kind === "until" ? parsed.end.day : "",
    times: parsed?.end.kind === "count" ? String(parsed.end.times) : "1",
  };
}

/** The detail panel's Repeat fieldset: quick presets, a custom rule editor,
 * and the readable summary of the stored rule. */
export function RepeatFieldset({ task, onTaskChanged }: RepeatFieldsetProps): JSX.Element {
  const [draft, setDraft] = useState<RepeatDraft | null>(null);

  useEffect(() => {
    setDraft(null);
  }, [task.id]);

  async function setRecurrence(recurrence: string | null): Promise<void> {
    onTaskChanged(await updateTask(task.id, { recurrence }));
    setDraft(null);
  }

  async function saveDraft(): Promise<void> {
    if (draft === null) {
      return;
    }
    const interval = Number(draft.interval);
    const times = Number(draft.times);
    if (!Number.isInteger(interval) || interval < 1) {
      return;
    }
    if (draft.endKind === "count" && (!Number.isInteger(times) || times < 1)) {
      return;
    }
    if (draft.endKind === "until" && draft.untilDay === "") {
      return;
    }
    await setRecurrence(
      serializeRecurrence({
        freq: draft.freq,
        interval,
        byday: draft.freq === "WEEKLY" ? draft.byday : [],
        end:
          draft.endKind === "until"
            ? { kind: "until", day: draft.untilDay }
            : draft.endKind === "count"
              ? { kind: "count", times }
              : { kind: "never" },
      }),
    );
  }

  function toggleWeekday(day: Weekday): void {
    if (draft === null) {
      return;
    }
    const byday = draft.byday.includes(day)
      ? draft.byday.filter((existing) => existing !== day)
      : WEEKDAYS.filter((candidate) => candidate === day || draft.byday.includes(candidate));
    setDraft({ ...draft, byday });
  }

  return (
    <fieldset className="task-repeat">
      <legend>Repeat</legend>
      {task.due_date === null ? (
        <p className="hint">Set a date to make this Task repeat.</p>
      ) : draft !== null ? (
        <div className="repeat-editor">
          <label>
            Repeat every
            <input
              type="number"
              min={1}
              aria-label="Repeat every"
              value={draft.interval}
              onChange={(event) => setDraft({ ...draft, interval: event.target.value })}
            />
          </label>
          <select
            aria-label="Frequency"
            value={draft.freq}
            onChange={(event) => setDraft({ ...draft, freq: event.target.value as Freq })}
          >
            {(Object.keys(FREQ_NOUNS) as Freq[]).map((freq) => (
              <option key={freq} value={freq}>
                {FREQ_NOUNS[freq]}
              </option>
            ))}
          </select>
          {draft.freq === "WEEKLY" && (
            <div className="repeat-weekdays">
              {WEEKDAYS.map((day) => (
                <label key={day}>
                  <input
                    type="checkbox"
                    aria-label={`Repeat on ${WEEKDAY_LABELS[day]}`}
                    checked={draft.byday.includes(day)}
                    onChange={() => toggleWeekday(day)}
                  />
                  {WEEKDAY_LABELS[day]}
                </label>
              ))}
            </div>
          )}
          <label>
            Ends
            <select
              aria-label="Ends"
              value={draft.endKind}
              onChange={(event) =>
                setDraft({ ...draft, endKind: event.target.value as RepeatDraft["endKind"] })
              }
            >
              <option value="never">Never</option>
              <option value="until">On a date</option>
              <option value="count">After a number of times</option>
            </select>
          </label>
          {draft.endKind === "until" && (
            <label>
              Ends on
              <input
                type="date"
                aria-label="Ends on"
                value={draft.untilDay}
                onChange={(event) => setDraft({ ...draft, untilDay: event.target.value })}
              />
            </label>
          )}
          {draft.endKind === "count" && (
            <label>
              Ends after
              <input
                type="number"
                min={1}
                aria-label="Ends after"
                value={draft.times}
                onChange={(event) => setDraft({ ...draft, times: event.target.value })}
              />
              times
            </label>
          )}
          <button type="button" onClick={() => void saveDraft()}>
            Save repeat
          </button>
          <button type="button" onClick={() => setDraft(null)}>
            Cancel
          </button>
        </div>
      ) : task.recurrence !== null ? (
        <div className="repeat-summary">
          <p>{recurrenceLabel(task.recurrence)}</p>
          <button type="button" onClick={() => setDraft(repeatDraftFrom(task.recurrence))}>
            Edit repeat
          </button>
          <button type="button" onClick={() => void setRecurrence(null)}>
            Remove repeat
          </button>
        </div>
      ) : (
        <select
          aria-label="Repeat"
          value=""
          onChange={(event) => {
            const choice = event.target.value;
            if (choice === "custom") {
              setDraft(repeatDraftFrom(null));
            } else if (choice !== "") {
              void setRecurrence(choice);
            }
          }}
        >
          <option value="">Doesn&apos;t repeat</option>
          <option value="FREQ=DAILY">Every day</option>
          <option value="FREQ=WEEKLY">Every week</option>
          <option value="FREQ=MONTHLY">Every month</option>
          <option value="FREQ=YEARLY">Every year</option>
          <option value="custom">Custom…</option>
        </select>
      )}
    </fieldset>
  );
}
