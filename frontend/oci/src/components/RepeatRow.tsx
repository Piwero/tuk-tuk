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

import { PropertyOptions, PropertyRow } from "./PropertyRow";

const CUSTOM = "custom";

const PRESETS: { value: string | null; label: string }[] = [
  { value: null, label: "Doesn't repeat" },
  { value: "FREQ=DAILY", label: "Every day" },
  { value: "FREQ=WEEKLY", label: "Every week" },
  { value: "FREQ=MONTHLY", label: "Every month" },
  { value: "FREQ=YEARLY", label: "Every year" },
];

interface RepeatRowProps {
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

/** The detail panel's Repeat row (#452): reads the stored rule (quietly when
 * unset) and opens a popover with quick presets and a custom rule editor. */
export function RepeatRow({ task, onTaskChanged }: RepeatRowProps): JSX.Element {
  const [draft, setDraft] = useState<RepeatDraft | null>(null);

  useEffect(() => {
    setDraft(null);
  }, [task.id]);

  async function setRecurrence(recurrence: string | null): Promise<void> {
    setDraft(null);
    if (recurrence !== task.recurrence) {
      onTaskChanged(await updateTask(task.id, { recurrence }));
    }
  }

  async function saveDraft(close: () => void): Promise<void> {
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
    close();
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

  const unset = task.recurrence === null;
  const selected = PRESETS.some((preset) => preset.value === task.recurrence)
    ? task.recurrence
    : CUSTOM;
  return (
    <PropertyRow
      label="Repeat"
      quiet={unset}
      disabled={task.due_date === null}
      value={
        task.due_date === null
          ? "Set a date to make this Task repeat."
          : unset
            ? "Doesn't repeat"
            : recurrenceLabel(task.recurrence ?? "")
      }
      onClose={() => setDraft(null)}
    >
      {(close) =>
        draft !== null ? (
          <div className="repeat-editor">
            <label>
              Repeat every
              <input
                type="number"
                min={1}
                aria-label="Repeat every"
                autoFocus
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
            <button className="btn-primary" type="button" onClick={() => void saveDraft(close)}>
              Save repeat
            </button>
            <button
              className="btn-quiet"
              type="button"
              onClick={() => {
                setDraft(null);
                close();
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <PropertyOptions<string | null>
            label="Repeat"
            options={[...PRESETS, { value: CUSTOM, label: "Custom…" }]}
            selected={selected}
            onSelect={(value) => {
              if (value === CUSTOM) {
                setDraft(repeatDraftFrom(task.recurrence));
                return;
              }
              close();
              void setRecurrence(value);
            }}
          />
        )
      }
    </PropertyRow>
  );
}
