import { useCallback, useEffect, useRef, useState } from "react";

import {
  ApiError,
  createCheckItem,
  createTask,
  fetchLists,
  fetchOpenTasks,
  fetchTags,
  postAssistantChat,
  updateTask,
  type AssistantChatMessage,
  type AssistantSuggestion,
  type Task,
  type TaskList,
  type Tag,
} from "../api";
import { browserTimeZone, formatDate, localDayOf } from "../dates";

type SuggestionStatus =
  | { kind: "pending"; accepted: boolean }
  | { kind: "applying" }
  | { kind: "applied" }
  | { kind: "failed"; reason: string };

interface SuggestionCard {
  id: number;
  suggestion: AssistantSuggestion;
  status: SuggestionStatus;
}

/** The Assistant's view (ADR 0009, issue #188): a bounded chat session —
 * the transcript lives only in this component's state and is posted whole
 * each turn, so a refresh clears it by design. Suggestions render as cards
 * once a turn's JSON is fully validated; there is no streaming (ADR 0009
 * again — a card can't render before it's known to be safe to show). */
export function AssistantView(): JSX.Element {
  const [transcript, setTranscript] = useState<AssistantChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [cards, setCards] = useState<SuggestionCard[]>([]);
  const [discardedCount, setDiscardedCount] = useState(0);
  const nextCardId = useRef(0);

  const [lists, setLists] = useState<TaskList[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tasksById, setTasksById] = useState<Map<number, Task>>(new Map());

  const loadEntities = useCallback(async () => {
    const [listPage, tagPage, taskPage] = await Promise.all([
      fetchLists(),
      fetchTags(),
      fetchOpenTasks(),
    ]);
    setLists(listPage.items);
    setTags(tagPage.items);
    // Merged, never replaced: the fetch returns only *open* tasks, so a
    // task an applied complete_task just closed would otherwise vanish
    // from this map and its own card would fall back to "Task #12".
    setTasksById((current) => {
      const merged = new Map(current);
      for (const task of taskPage.items) {
        merged.set(task.id, task);
      }
      return merged;
    });
  }, []);

  useEffect(() => {
    void loadEntities();
  }, [loadEntities]);

  function taskTitle(taskId: number): string {
    return tasksById.get(taskId)?.title ?? `Task #${taskId}`;
  }

  function describe(suggestion: AssistantSuggestion): string {
    switch (suggestion.type) {
      case "create_task":
        return `Create "${suggestion.title}"${
          suggestion.list_name ? ` in ${suggestion.list_name}` : ""
        }`;
      case "schedule_task":
      case "reschedule_task": {
        const verb = suggestion.type === "schedule_task" ? "Schedule" : "Reschedule";
        const when = suggestion.due_date ?? suggestion.start_date;
        const whenLabel = when ? formatDate(new Date(when), "short") : "no date";
        return `${verb} "${taskTitle(suggestion.task_id)}" for ${whenLabel}`;
      }
      case "complete_task":
        return `Complete "${taskTitle(suggestion.task_id)}"`;
      case "set_priority":
        return `Set priority of "${taskTitle(suggestion.task_id)}" to ${suggestion.priority}`;
      case "set_list":
        return `Move "${taskTitle(suggestion.task_id)}" to ${suggestion.list_name}`;
      case "add_tags":
        return `Tag "${taskTitle(suggestion.task_id)}" with ${suggestion.tag_names.join(", ")}`;
      case "add_check_items":
        return `Add ${suggestion.check_item_titles.length} Check Item${
          suggestion.check_item_titles.length === 1 ? "" : "s"
        } to "${taskTitle(suggestion.task_id)}"`;
    }
  }

  async function sendMessage(): Promise<void> {
    const text = draft.trim();
    if (text === "" || sending) {
      return;
    }
    const nextTranscript: AssistantChatMessage[] = [...transcript, { role: "user", content: text }];
    setTranscript(nextTranscript);
    setDraft("");
    setSending(true);
    try {
      const turn = await postAssistantChat({
        transcript: nextTranscript,
        local_date: localDayOf(new Date()),
        time_zone: browserTimeZone(),
      });
      setTranscript((current) => [...current, { role: "assistant", content: turn.message }]);
      setDiscardedCount(turn.discarded_count);
      setCards((current) => [
        ...current,
        ...turn.suggestions.map((suggestion) => ({
          id: nextCardId.current++,
          suggestion,
          status: { kind: "pending", accepted: true } as SuggestionStatus,
        })),
      ]);
    } catch {
      // A genuine network failure (offline, unreachable server) rather
      // than a provider failure — those already come back as a normal
      // 200 with an apologetic message (ADR 0009). Either way, the owner
      // sees a message, never an error page.
      setTranscript((current) => [
        ...current,
        {
          role: "assistant",
          content:
            "Sorry, I couldn't reach the planning assistant just now. Please try again in a moment.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function toggleAccepted(cardId: number): void {
    setCards((current) =>
      current.map((card) =>
        card.id === cardId && card.status.kind === "pending"
          ? { ...card, status: { kind: "pending", accepted: !card.status.accepted } }
          : card,
      ),
    );
  }

  async function applyOne(suggestion: AssistantSuggestion): Promise<void> {
    const listsByName = new Map(lists.map((list) => [list.name, list.id]));
    const tagsByName = new Map(tags.map((tag) => [tag.name, tag.id]));

    switch (suggestion.type) {
      case "create_task": {
        const list_id = suggestion.list_name ? listsByName.get(suggestion.list_name) : undefined;
        const tag_ids = suggestion.tag_names
          .map((name) => tagsByName.get(name))
          .filter((id): id is number => id !== undefined);
        await createTask({
          title: suggestion.title,
          list_id,
          tag_ids,
          priority: suggestion.priority,
          start_date: suggestion.start_date ?? undefined,
          due_date: suggestion.due_date ?? undefined,
          is_all_day: suggestion.is_all_day,
          time_zone: suggestion.time_zone ?? undefined,
        });
        return;
      }
      case "schedule_task":
      case "reschedule_task":
        await updateTask(suggestion.task_id, {
          start_date: suggestion.start_date ?? undefined,
          due_date: suggestion.due_date ?? undefined,
          is_all_day: suggestion.is_all_day,
          time_zone: suggestion.time_zone ?? undefined,
        });
        return;
      case "complete_task":
        await updateTask(suggestion.task_id, { completed: true });
        return;
      case "set_priority":
        await updateTask(suggestion.task_id, { priority: suggestion.priority });
        return;
      case "set_list": {
        const list_id = listsByName.get(suggestion.list_name);
        if (list_id === undefined) {
          throw new ApiError("not_found", `List "${suggestion.list_name}" no longer exists`);
        }
        await updateTask(suggestion.task_id, { list_id });
        return;
      }
      case "add_tags": {
        const existing = tasksById.get(suggestion.task_id)?.tags.map((tag) => tag.id) ?? [];
        const added = suggestion.tag_names
          .map((name) => tagsByName.get(name))
          .filter((id): id is number => id !== undefined);
        await updateTask(suggestion.task_id, {
          tag_ids: [...new Set([...existing, ...added])],
        });
        return;
      }
      case "add_check_items":
        for (const title of suggestion.check_item_titles) {
          await createCheckItem(suggestion.task_id, title);
        }
        return;
    }
  }

  /** Applies every currently accepted, still-pending card sequentially
   * through the ordinary v1 endpoints (ADR 0009) — one Suggestion's
   * failure is reported on its own card and never stops the rest. */
  async function applyAccepted(): Promise<void> {
    const toApply = cards.filter((card) => card.status.kind === "pending" && card.status.accepted);
    if (toApply.length === 0) {
      return;
    }
    setCards((current) =>
      current.map((card) =>
        toApply.some((c) => c.id === card.id) ? { ...card, status: { kind: "applying" } } : card,
      ),
    );
    for (const card of toApply) {
      try {
        await applyOne(card.suggestion);
        setCards((current) =>
          current.map((c) => (c.id === card.id ? { ...c, status: { kind: "applied" } } : c)),
        );
      } catch (error) {
        const reason = error instanceof ApiError ? error.message : "Something went wrong";
        setCards((current) =>
          current.map((c) => (c.id === card.id ? { ...c, status: { kind: "failed", reason } } : c)),
        );
      }
    }
    void loadEntities();
  }

  const acceptedCount = cards.filter(
    (card) => card.status.kind === "pending" && card.status.accepted,
  ).length;

  return (
    <div className="assistant-view">
      <div className="assistant-transcript" aria-label="Assistant conversation">
        {transcript.length === 0 && (
          <p className="settings-hint">
            Describe your day or week — the Assistant reads your tasks and events and suggests a
            plan.
          </p>
        )}
        {transcript.map((turn, index) => (
          <p
            key={index}
            className={turn.role === "user" ? "assistant-message user" : "assistant-message"}
          >
            {turn.content}
          </p>
        ))}
        {sending && (
          <p className="assistant-thinking" aria-label="Assistant is thinking">
            Thinking…
          </p>
        )}
      </div>

      {discardedCount > 0 && (
        <p className="assistant-discarded">
          {discardedCount} suggestion{discardedCount === 1 ? "" : "s"} couldn't be applied and
          {discardedCount === 1 ? " was" : " were"} left out.
        </p>
      )}

      {cards.length > 0 && (
        <div className="assistant-suggestions" aria-label="Suggestions">
          <ul>
            {cards.map((card) => (
              <li key={card.id} className="assistant-suggestion-card">
                <label>
                  <input
                    type="checkbox"
                    checked={card.status.kind === "pending" ? card.status.accepted : true}
                    disabled={card.status.kind !== "pending"}
                    onChange={() => toggleAccepted(card.id)}
                  />
                  {describe(card.suggestion)}
                </label>
                {card.status.kind === "applying" && (
                  <span className="assistant-suggestion-status">Applying…</span>
                )}
                {card.status.kind === "applied" && (
                  <span className="assistant-suggestion-status applied">Applied</span>
                )}
                {card.status.kind === "failed" && (
                  <span className="assistant-suggestion-status failed">
                    Failed: {card.status.reason}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => void applyAccepted()} disabled={acceptedCount === 0}>
            Apply {acceptedCount > 0 ? acceptedCount : ""} suggestion
            {acceptedCount === 1 ? "" : "s"}
          </button>
        </div>
      )}

      <form
        className="assistant-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void sendMessage();
        }}
      >
        <input
          aria-label="Describe your day"
          placeholder="Describe your day or week…"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={sending}
        />
        <button type="submit" disabled={sending || draft.trim() === ""}>
          Send
        </button>
      </form>
    </div>
  );
}
