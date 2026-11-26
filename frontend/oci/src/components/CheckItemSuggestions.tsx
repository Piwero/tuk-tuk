import { useEffect, useRef, useState } from "react";
import {
  createCheckItem,
  fetchAssistantConfig,
  suggestCheckItems,
  type AssistantConfig,
  type Task,
} from "../api";
import "./CheckItemSuggestions.css";

type Step = { title: string; requestId: string; saved: boolean };
type Group = {
  steps: Step[];
  state: "ready" | "saving" | "failed" | "saved";
  keepDuplicates: boolean;
};

export function CheckItemSuggestions({
  task,
  onTaskChanged,
}: {
  task: Task;
  onTaskChanged: (task: Task) => void;
}): React.JSX.Element | null {
  const [config, setConfig] = useState<AssistantConfig | null>(null);
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(3);
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [groups, setGroups] = useState<Group[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const controller = useRef<AbortController | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  const saving = useRef(false);
  useEffect(() => {
    alive.current = true;
    void fetchAssistantConfig().then(
      (value) => {
        if (alive.current) setConfig(value);
      },
      () => {},
    );
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);
  if (!config?.base_url || !config.model || !config.api_key_set) return null;
  let host: string;
  try {
    host = new URL(config.base_url).hostname;
  } catch {
    return null;
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(host);
  function close(): void {
    controller.current?.abort();
    setLoading(false);
    setOpen(false);
    setGroups([]);
    setError("");
    opener.current?.focus();
  }
  function changeGroup(index: number, change: Partial<Group>): void {
    setGroups((current) =>
      current.map((group, i) => (i === index ? { ...group, ...change } : group)),
    );
  }
  async function generate(): Promise<void> {
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setError("");
    setGroups([]);
    setAnnouncement("");
    try {
      const result = await suggestCheckItems(task.id, count, instruction, abort.signal);
      if (abort.signal.aborted || !alive.current) return;
      if (
        result.suggestions.some((s) => s.task_id !== task.id || s.type !== "add_check_items") ||
        result.suggestions.reduce((n, s) => n + s.check_item_titles.length, 0) > count
      )
        throw new Error("Invalid output");
      setGroups(
        result.suggestions.map((suggestion) => ({
          steps: suggestion.check_item_titles.map((title) => ({
            title,
            requestId: crypto.randomUUID(),
            saved: false,
          })),
          state: "ready",
          keepDuplicates: false,
        })),
      );
    } catch {
      if (!abort.signal.aborted && alive.current)
        setError("Assistant unavailable. Task unchanged. Add Check Items manually below.");
    } finally {
      if (!abort.signal.aborted && alive.current) setLoading(false);
    }
  }
  async function accept(index: number): Promise<void> {
    if (saving.current) return;
    const group = groups[index];
    if (!group || group.state === "saved" || group.state === "saving") return;
    saving.current = true;
    changeGroup(index, { state: "saving" });
    setAnnouncement("");
    let saved = group.steps.filter((step) => step.saved).length;
    try {
      for (const step of group.steps) {
        if (!alive.current) break;
        if (step.saved) continue;
        const updated = await createCheckItem(task.id, step.title, step.requestId);
        step.saved = true;
        saved++;
        if (alive.current) onTaskChanged(updated);
      }
      if (alive.current) {
        changeGroup(index, { state: "saved" });
        setAnnouncement(`Saved ${saved} Check Item${saved === 1 ? "" : "s"}.`);
      }
    } catch {
      if (alive.current) {
        changeGroup(index, { state: "failed" });
        setAnnouncement(
          `${saved} confirmed saved. Remaining outcome unknown; retry safely with the same titles, or check Task manually.`,
        );
      }
    } finally {
      saving.current = false;
    }
  }
  return (
    <div className="check-item-suggestions">
      <button ref={opener} type="button" onClick={() => setOpen(true)} aria-expanded={open}>
        Suggest Check Items
      </button>
      {open && (
        <section
          aria-label="Check Item Suggestions"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !saving.current) {
              event.stopPropagation();
              close();
            }
          }}
        >
          <h3>Check Item Suggestions · {task.title}</h3>
          <p>
            Only this Task title, description, existing Check Items and your instruction are sent.
            No other Tasks, preferences or conversation.
          </p>
          <p>
            {config.model} · {host} ·{" "}
            {local
              ? "Local processing (loopback provider)"
              : "Cloud / remote processing (not verified local)"}
          </p>
          <p>Not saved until accepted. Refresh discards unaccepted Suggestions.</p>
          <label>
            Number of steps
            <select
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
              disabled={loading || groups.length > 0}
            >
              {[1, 3, 5, 10].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            Instruction (optional)
            <textarea
              maxLength={2000}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              disabled={loading}
            />
          </label>
          <button
            type="button"
            disabled={loading || groups.length > 0}
            onClick={() => void generate()}
          >
            Suggest steps
          </button>
          <button type="button" disabled={groups.some((g) => g.state === "saving")} onClick={close}>
            Cancel suggestions
          </button>
          {loading && (
            <p role="status">Requesting steps. Manual Check Item entry remains available below.</p>
          )}
          {error && <p role="alert">{error}</p>}
          {groups.map((group, index) => {
            const duplicates = group.steps.some(
              (step) =>
                !step.saved &&
                (task.check_items.some((item) => item.title === step.title) ||
                  groups.flatMap((g) => g.steps).filter((s) => s.title === step.title).length > 1),
            );
            const locked = group.state !== "ready";
            const invalid = group.steps.some(
              (step) => step.title.length < 1 || step.title.length > 500,
            );
            return (
              <fieldset key={index}>
                <legend>
                  {group.state === "saved" ? "Saved" : "Not saved until accepted"} · Suggestion{" "}
                  {index + 1}
                </legend>
                {group.steps.map((step, stepIndex) => (
                  <label key={step.requestId}>
                    Step {index + 1}.{stepIndex + 1}
                    <input
                      value={step.title}
                      maxLength={500}
                      disabled={locked || step.saved}
                      aria-invalid={step.title.length === 0}
                      aria-describedby={
                        step.title.length === 0 ? `step-error-${step.requestId}` : undefined
                      }
                      onChange={(event) =>
                        changeGroup(index, {
                          steps: group.steps.map((s, i) =>
                            i === stepIndex ? { ...s, title: event.target.value } : s,
                          ),
                          keepDuplicates: false,
                        })
                      }
                    />
                    {step.saved && <span>Saved</span>}
                    {step.title.length === 0 && (
                      <span id={`step-error-${step.requestId}`}>Enter a title.</span>
                    )}
                  </label>
                ))}
                {duplicates && (
                  <label>
                    <input
                      type="checkbox"
                      checked={group.keepDuplicates}
                      disabled={locked}
                      onChange={(event) =>
                        changeGroup(index, { keepDuplicates: event.target.checked })
                      }
                    />
                    Exact duplicate title. Keep duplicates deliberately
                  </label>
                )}
                <button
                  type="button"
                  disabled={
                    invalid ||
                    (duplicates && !group.keepDuplicates && group.state !== "failed") ||
                    group.state === "saving" ||
                    group.state === "saved" ||
                    groups.some((g) => g.state === "saving")
                  }
                  onClick={() => void accept(index)}
                >
                  {group.state === "failed" ? "Retry Add" : "Add"}
                </button>
                <button
                  type="button"
                  disabled={group.state === "saving" || group.state === "saved"}
                  onClick={() => setGroups((current) => current.filter((_, i) => i !== index))}
                >
                  Discard
                </button>
              </fieldset>
            );
          })}
          <p role="status" aria-live="polite">
            {announcement}
          </p>
        </section>
      )}
    </div>
  );
}
