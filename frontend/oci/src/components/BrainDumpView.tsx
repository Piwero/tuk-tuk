import "./BrainDumpView.css";
import { assistantProviderHost } from "../assistantProvider";
import { useEffect, useRef, useState } from "react";

import {
  ApiError,
  createTaskIdempotently,
  fetchAssistantConfig,
  postBrainDump,
  type AssistantConfig,
  type BrainDumpDraft,
  type TaskCreateInput,
} from "../api";

interface DraftState {
  draft: BrainDumpDraft;
  key: string;
  date: string;
  reviewed: boolean;
  state: "pending" | "saving" | "saved" | "failed" | "discarded";
}

export function BrainDumpView(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [original, setOriginal] = useState("");
  const [config, setConfig] = useState<AssistantConfig | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<DraftState[]>([]);
  const active = useRef(new Set<string>());
  const accepted = useRef(new Map<string, TaskCreateInput>());
  const generation = useRef(0);
  useEffect(() => {
    if (open)
      void fetchAssistantConfig()
        .then(setConfig)
        .catch(() => setConfig(null));
  }, [open]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );

  function cancel(): void {
    generation.current++;
    setLoading(false);
    setOpen(false);
    setRows([]);
    setError("");
  }
  async function send(): Promise<void> {
    if (!input.trim() || input.length > 12000 || loading) return;
    const request = ++generation.current;
    setOriginal(input);
    setLoading(true);
    setError("");
    try {
      const turn = await postBrainDump(input);
      if (request !== generation.current) return;
      if (turn.suggestions.length > 10 || turn.discarded_count) {
        setError("Use another deliberate batch of at most ten thoughts. No drafts were accepted.");
        return;
      }
      setRows(
        turn.suggestions.map((draft) => ({
          draft,
          key: crypto.randomUUID(),
          date: "",
          reviewed: !draft.due_date && !draft.start_date,
          state: "pending",
        })),
      );
      setMessage(turn.message);
    } catch (failure) {
      if (request === generation.current)
        setError(
          failure instanceof ApiError
            ? failure.message
            : "Assistant unavailable. Your original text is unchanged. Use manual Task creation.",
        );
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }
  function patch(index: number, change: Partial<DraftState>): void {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...change } : row)));
  }
  async function save(index: number): Promise<void> {
    const row = rows[index];
    if (
      !row ||
      !["pending", "failed"].includes(row.state) ||
      active.current.has(row.key) ||
      !row.draft.title.trim() ||
      !row.reviewed
    )
      return;
    active.current.add(row.key);
    // A failed request may already have committed. Freeze its payload as well
    // as its identifier, so retries never mean a different write.
    const payload = accepted.current.get(row.key) ?? {
      title: row.draft.title.trim(),
      ...(row.date ? { due_date: `${row.date}T00:00:00Z`, is_all_day: true } : {}),
    };
    accepted.current.set(row.key, payload);
    patch(index, { state: "saving" });
    try {
      await createTaskIdempotently(payload, row.key);
      patch(index, { state: "saved" });
    } catch {
      patch(index, { state: "failed" });
    } finally {
      active.current.delete(row.key);
    }
  }
  const configured = Boolean(config?.base_url && config.model && config.api_key_set);
  let provider = "Assistant not configured. Manual Task creation remains available.";
  if (configured && config) {
    const local = assistantProviderHost(config.base_url!)?.local ?? false;
    provider = `${config.model} · ${config.base_url} · ${local ? "Local" : "Cloud / remote"}`;
  }
  return (
    <section className="brain-dump" aria-label="Brain dump">
      <button className="btn-secondary" type="button" onClick={() => setOpen(true)}>
        Brain dump to Tasks
      </button>
      {open && (
        <>
          <h2>Turn pasted text into Task drafts</h2>
          <p>{provider}</p>
          <p>
            Send only your pasted text and an explicit extraction instruction. No Tasks, Events,
            preferences, transcript, or tools are sent.
          </p>
          <p>
            Proposals are temporary. Refreshing loses unsaved drafts and original text; saved Tasks
            remain. Review and save each Task separately.
          </p>
          <label htmlFor="brain-dump-input">Pasted text</label>
          <textarea
            id="brain-dump-input"
            aria-describedby="brain-dump-help brain-dump-error"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <p id="brain-dump-help">
            At most 12,000 characters and ten drafts. For more, send another deliberate batch.
            Manual Quick-Add is always available.
          </p>
          <button
            className="btn-secondary"
            type="button"
            disabled={
              !configured ||
              loading ||
              !input.trim() ||
              input.length > 12000 ||
              rows.some((r) => !["saved", "discarded"].includes(r.state))
            }
            onClick={() => void send()}
          >
            {loading ? "Preparing…" : "Suggest Tasks"}
          </button>
          <button
            className="btn-secondary"
            type="button"
            onClick={cancel}
            disabled={rows.some((r) => r.state === "saving")}
          >
            Cancel brain dump
          </button>
          <p id="brain-dump-error" role={error || input.length > 12000 ? "alert" : undefined}>
            {input.length > 12000
              ? "Text exceeds 12,000 characters. Split it into another deliberate batch; nothing has been truncated."
              : error}
          </p>
          {original && (
            <details open>
              <summary>Original text</summary>
              <pre>{original}</pre>
            </details>
          )}
          {message && <p>{message}</p>}
          {rows.map((row, index) =>
            row.state === "discarded" ? null : (
              <article key={row.key} aria-label={`Task draft ${index + 1}`}>
                <label htmlFor={`brain-title-${index}`}>Task title</label>
                <input
                  id={`brain-title-${index}`}
                  value={row.draft.title}
                  disabled={row.state !== "pending"}
                  maxLength={500}
                  onChange={(e) => patch(index, { draft: { ...row.draft, title: e.target.value } })}
                />
                {(row.draft.due_date || row.draft.start_date) && (
                  <p>
                    Proposed date: {row.draft.due_date ?? row.draft.start_date}. Not a deadline
                    until you choose a date below.
                  </p>
                )}
                <label htmlFor={`brain-date-${index}`}>Choose date</label>
                <input
                  id={`brain-date-${index}`}
                  type="date"
                  disabled={row.state !== "pending"}
                  value={row.date}
                  onChange={(e) => patch(index, { date: e.target.value, reviewed: true })}
                />
                <button
                  className="btn-secondary"
                  type="button"
                  disabled={row.state !== "pending"}
                  onClick={() => patch(index, { date: "", reviewed: true })}
                >
                  No date
                </button>
                <p>Inbox · {row.state === "saved" ? "Saved" : "Not saved"}</p>
                {row.state === "pending" && (
                  <>
                    <button
                      className="btn-secondary"
                      type="button"
                      disabled={!row.draft.title.trim() || !row.reviewed}
                      onClick={() => void save(index)}
                    >
                      Save Task
                    </button>
                    <button
                      className="btn-secondary"
                      type="button"
                      onClick={() => patch(index, { state: "discarded" })}
                    >
                      Discard
                    </button>
                  </>
                )}
                <p role="status">
                  {row.state === "saving"
                    ? "Saving…"
                    : row.state === "saved"
                      ? "Task saved."
                      : row.state === "failed"
                        ? "Save outcome unknown. Retry safely with the same request; your other drafts are unchanged."
                        : ""}
                </p>
                {row.state === "failed" && (
                  <button className="btn-secondary" type="button" onClick={() => void save(index)}>
                    Retry Save
                  </button>
                )}
              </article>
            ),
          )}
        </>
      )}
    </section>
  );
}
