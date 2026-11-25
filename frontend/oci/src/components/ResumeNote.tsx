import "./ResumeNote.css";
import { useEffect, useId, useState } from "react";

import { fetchNowSelection, fetchResumeNote, updateResumeNote } from "../api";

/** Resume note (issue #554): an optional cue the User leaves for picking the
 * Now selection back up, offered while a Focus Session is paused. Never a
 * required step: it renders nothing without a Now selection, and leaving
 * it empty changes nothing. A failed save keeps the text for a retry. */
export function ResumeNote(): React.JSX.Element | null {
  const [loaded, setLoaded] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const fieldId = useId();
  const errorId = useId();

  useEffect(() => {
    let live = true;
    void Promise.all([fetchNowSelection(), fetchResumeNote()])
      .then(([selection, saved]) => {
        if (live) {
          setHasSelection(selection.task_id !== null);
          setText(saved.note ?? "");
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (live) setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, []);

  if (!loaded || !hasSelection) {
    return null;
  }

  async function save(): Promise<void> {
    setStatus("saving");
    try {
      const saved = await updateResumeNote(text.trim() === "" ? null : text);
      setText(saved.note ?? "");
      setStatus("saved");
    } catch {
      setStatus("failed");
    }
  }

  const failed = status === "failed";
  return (
    <form
      className="resume-note"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label htmlFor={fieldId}>Resume note</label>
      <p className="resume-note-hint">Optional: a cue for where to pick up.</p>
      <input
        id={fieldId}
        className="resume-note-field"
        type="text"
        maxLength={500}
        value={text}
        aria-invalid={failed ? true : undefined}
        aria-describedby={failed ? errorId : undefined}
        onChange={(event) => {
          setText(event.target.value);
          if (status === "saved") setStatus("idle");
        }}
      />
      {failed && (
        <p className="resume-note-error" id={errorId}>
          Couldn&apos;t save the note. Try again.
        </p>
      )}
      <div className="resume-note-actions">
        <button type="submit" className="btn-secondary" disabled={status === "saving"}>
          Save note
        </button>
        <span role="status" className="resume-note-status">
          {status === "saved" ? "Note saved" : ""}
        </span>
      </div>
    </form>
  );
}
