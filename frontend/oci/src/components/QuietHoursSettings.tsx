import { useEffect, useId, useState } from "react";

import {
  ApiError,
  fetchQuietHoursSettings,
  updateQuietHoursSettings,
  type QuietHoursSettings as QuietHoursBand,
} from "../api";

/** Every quarter hour of the day, "00:00" to "23:45". */
const QUARTER_HOUR_LABELS: string[] = Array.from({ length: 96 }, (_, index) => {
  const minutes = index * 15;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});

/** The saved labels plus the quarter hours, so a band saved off the grid
 * (through the API) still shows as it is. */
function labelsWith(...extra: string[]): string[] {
  return [...new Set([...QUARTER_HOUR_LABELS, ...extra])].sort();
}

/** Settings > Quiet hours (issue #567). Its own section, never Active
 * hours: this band only holds Reminder notifications, which notify once
 * when it ends. The band may wrap past midnight; a start equal to the end
 * is refused here before it is sent, and anything else the server refuses
 * shows the server's reason. */
export function QuietHoursSettings(): React.JSX.Element {
  const [band, setBand] = useState<QuietHoursBand>({
    enabled: false,
    start: "22:00",
    end: "07:00",
  });
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    void fetchQuietHoursSettings()
      .then(setBand)
      .catch(() => {});
  }, []);

  const same = band.start === band.end;
  const sameErrorId = useId();
  // The refusal is about the pair, so both fields name it.
  const describedBy = same ? sameErrorId : undefined;

  function apply(next: QuietHoursBand): void {
    setBand(next);
    setSaveError(null);
    if (next.start === next.end) return;
    updateQuietHoursSettings(next)
      .then(setBand)
      .catch((error: unknown) =>
        setSaveError(error instanceof ApiError ? error.message : "Try again."),
      );
  }

  const labels = labelsWith(band.start, band.end);
  return (
    <>
      <div className="settings-section-head">
        <h2>Quiet hours</h2>
        <span className="settings-status" data-state={band.enabled ? "on" : "off"}>
          {band.enabled ? "On" : "Off"}
        </span>
      </div>
      <div className="settings-field">
        <p className="settings-hint">
          Reminders that fall due during quiet hours are held and notify once when quiet hours end.
          Held reminders stay listed in Tuk Tuk meanwhile. This is not Active hours: Active hours
          only shape the calendar and never change when reminders notify. There is no exception for
          urgent reminders.
        </p>
        <label>
          <input
            type="checkbox"
            checked={band.enabled}
            onChange={() => apply({ ...band, enabled: !band.enabled })}
          />
          Hold reminders during quiet hours
        </label>
        <div className="settings-field-with-action">
          <label>
            Quiet from
            <select
              value={band.start}
              aria-describedby={describedBy}
              onChange={(event) => apply({ ...band, start: event.target.value })}
            >
              {labels.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Quiet until
            <select
              value={band.end}
              aria-invalid={same || undefined}
              aria-describedby={describedBy}
              onChange={(event) => apply({ ...band, end: event.target.value })}
            >
              {labels.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!same && band.start > band.end && (
          <p className="settings-hint">Ends at {band.end} the next day.</p>
        )}
        {same && (
          <p role="alert" id={sameErrorId}>
            Quiet hours must start and end at different times.
          </p>
        )}
        {saveError !== null && <p role="alert">Couldn&rsquo;t save quiet hours: {saveError}</p>}
      </div>
    </>
  );
}
