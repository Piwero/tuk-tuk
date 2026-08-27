import { useEffect, useRef, useState } from "react";

import {
  createList,
  createTag,
  createTask,
  type Priority,
  type Tag,
  type Task,
  type TaskList,
} from "../api";
import {
  formatRecurrenceRule,
  formatReminderOffset,
  parseCaptureWithTimeout,
} from "../assistCapture";
import { PRIORITY_LABELS } from "../grouping";
import { applyListPick, suggestLists } from "../listSuggest";
import { applyPriorityPick, suggestPriority } from "../prioritySuggest";
import { parseQuickAdd, sameName } from "../quickAdd";
import { applyTagPick, suggestTags } from "../tagSuggest";
import { useAssistAvailable } from "../useAssistAvailable";
import { Icon } from "./Icon";
import { TokenInput, type TokenChannel } from "./TokenInput";

function formatDraftDate(dueDate: string, isAllDay: boolean): string {
  const date = new Date(dueDate);
  if (isAllDay) {
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** One Assisted Capture confirmation beat (ADR 0005; issue #43): the
 * chip/tag/list/priority state a parse was triggered against, plus the
 * proposed title and resolved date it came back with. Confirming (Enter)
 * creates the Task from `suggestedTitle` + the resolved date; discarding
 * (Escape / the dismiss button) creates it from `typedTitle` instead, with
 * no date — "exactly as typed". */
interface CaptureDraft {
  typedTitle: string;
  tagChips: Tag[];
  listChip: TaskList[];
  priorityChip: Priority[];
  suggestedTitle: string;
  dueDate: string | null;
  isAllDay: boolean;
  timeZone: string | null;
  // RRULE content and reminder offsets resolved from recurrence/reminder
  // phrases (issue #44) — rendered as their own chips, confirmed straight
  // through to Task.recurrence/Task.reminders on the create call.
  recurrence: string | null;
  reminders: string[];
  // Explicit `#tag`/`~list`/`!priority` tokens the typed text still had at
  // submit time (issue #45) — parsed client-side before the residual text
  // ever reached the parse endpoint, so they're captured here rather than
  // re-derivable from `suggestedTitle`. Always outrank the proposed fields
  // below on confirm (CONTEXT.md: token-derived fields are never
  // overridden by a model suggestion).
  tokenTagNames: string[];
  tokenListId: number | null;
  tokenPriority: Priority | null;
  // Matched-existing-only List/Tag/Priority suggestions (issue #45) — same
  // "only ever adds value" posture as the date/recurrence/reminder
  // suggestions above: every one of these can be null/empty with nothing
  // else about the draft changing.
  suggestedListName: string | null;
  suggestedTagNames: string[];
  suggestedPriority: Priority | null;
}

interface QuickAddProps {
  /** The viewed List — the default target when no `~list` token or chip
   * names one. */
  listId: number;
  lists: TaskList[];
  tags: Tag[];
  onTagCreated: (tag: Tag) => void;
  onListCreated: (list: TaskList) => void;
  onCreated: (task: Task) => void;
  /** Names the filing target in context — e.g. the Folder view (#126) names
   * the List a Task lands in absent a `~list` token, since it isn't the
   * List currently on screen. Defaults to the plain List view wording. */
  placeholder?: string;
}

export function QuickAdd({
  listId,
  lists,
  tags,
  onTagCreated,
  onListCreated,
  onCreated,
  placeholder = "Add a task…",
}: QuickAddProps): JSX.Element {
  const [title, setTitle] = useState("");
  const [tagChips, setTagChips] = useState<Tag[]>([]);
  const [listChip, setListChip] = useState<TaskList[]>([]);
  const [priorityChip, setPriorityChip] = useState<Priority[]>([]);
  // ADR 0005 / issue #42: invisible, not greyed out, when Ollama isn't
  // reachable.
  const assistAvailable = useAssistAvailable();
  // Assisted Capture (ADR 0005; issue #43): set while the one parse a
  // submit triggers is in flight (the capture bar's busy indicator), and
  // while a proposed draft is awaiting its confirmation beat.
  const [parsing, setParsing] = useState(false);
  const [draft, setDraft] = useState<CaptureDraft | null>(null);
  // The draft row has no text input of its own — focus moves here so the
  // form's key handler (Enter to confirm, Escape to discard) keeps
  // receiving events even though nothing is focused inside a live input.
  const draftRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (draft !== null) {
      draftRef.current?.focus();
    }
  }, [draft]);

  /** Assist suggestions (issue #45) confirmed alongside a draft — always
   * outranked by a chip or an explicit token, per CONTEXT.md's Assist
   * glossary. Absent on every non-Assist call to `finalizeCreate`. Same
   * six fields `CaptureDraft` carries, named once and reused there. */
  type AssistExtra = Pick<
    CaptureDraft,
    | "tokenTagNames"
    | "tokenListId"
    | "tokenPriority"
    | "suggestedListName"
    | "suggestedTagNames"
    | "suggestedPriority"
  >;

  /** The shared tail of every Task creation — plain, Assisted-Capture
   * confirmed, or Assisted-Capture discarded all funnel through this one
   * call to the existing task-creation API (ADR 0005: confirming a
   * Suggestion is not a separate persistence path). */
  async function finalizeCreate(
    rawTitle: string,
    schedule: {
      due_date?: string;
      is_all_day?: boolean;
      time_zone?: string;
      recurrence?: string;
      reminders?: string[];
    },
    snapshot: { tagChips: Tag[]; listChip: TaskList[]; priorityChip: Priority[] },
    extra?: AssistExtra,
  ): Promise<void> {
    // A chip is a deliberate pick — it wins over a same-named raw token, and
    // that token is left in the title rather than silently consumed too.
    const plan = parseQuickAdd(rawTitle, lists, {
      skipListToken: snapshot.listChip.length > 0,
      skipPriorityToken: snapshot.priorityChip.length > 0,
    });
    if (plan.title === "") {
      return;
    }
    // Chips, any raw #tokens left in the title, and any #tokens Assist's
    // parse already consumed from the typed text (issue #45) are unioned
    // and deduplicated case-insensitively by name. Unknown names create the
    // Tag on the fly — the same explicit, deterministic-parser behavior as
    // today, never something Assist's own tag suggestions get to do.
    const tagIds: number[] = [];
    const seen: string[] = [];
    for (const chip of snapshot.tagChips) {
      if (!seen.some((name) => sameName(name, chip.name))) {
        seen.push(chip.name);
        tagIds.push(chip.id);
      }
    }
    for (const name of [...plan.tagNames, ...(extra?.tokenTagNames ?? [])]) {
      if (seen.some((seenName) => sameName(seenName, name))) {
        continue;
      }
      seen.push(name);
      const existing = tags.find((tag) => sameName(tag.name, name));
      if (existing !== undefined) {
        tagIds.push(existing.id);
      } else {
        const created = await createTag({ name });
        onTagCreated(created);
        tagIds.push(created.id);
      }
    }
    // Assist's proposed tags are match-existing-only (never create), and
    // only apply when no chip or explicit token already named a tag — a
    // token-derived field is never overridden by a model suggestion.
    if (seen.length === 0) {
      for (const name of extra?.suggestedTagNames ?? []) {
        const existing = tags.find((tag) => sameName(tag.name, name));
        if (existing !== undefined) {
          tagIds.push(existing.id);
        }
      }
    }
    const suggestedListId =
      extra?.suggestedListName == null
        ? null
        : (lists.find((list) => sameName(list.name, extra.suggestedListName as string))?.id ??
          null);
    const finalListId =
      snapshot.listChip[0]?.id ?? plan.listId ?? extra?.tokenListId ?? suggestedListId ?? listId;
    const finalPriority =
      snapshot.priorityChip[0] ?? plan.priority ?? extra?.tokenPriority ?? extra?.suggestedPriority;
    const task = await createTask({
      title: plan.title,
      list_id: finalListId,
      ...(finalPriority === null || finalPriority === undefined ? {} : { priority: finalPriority }),
      ...(tagIds.length === 0 ? {} : { tag_ids: tagIds }),
      ...schedule,
    });
    onCreated(task);
  }

  function resetInput(
    submittedTitle: string,
    snapshot: { tagChips: Tag[]; listChip: TaskList[]; priorityChip: Priority[] },
  ): void {
    setTitle((current) => (current === submittedTitle ? "" : current));
    setTagChips((current) => (current === snapshot.tagChips ? [] : current));
    setListChip((current) => (current === snapshot.listChip ? [] : current));
    setPriorityChip((current) => (current === snapshot.priorityChip ? [] : current));
    setDraft(null);
  }

  /** The common "nothing to confirm" tail — plain capture, Assist
   * unavailable, an extraction with no date, a parse failure/timeout, and
   * an explicit discard all funnel here: create the task exactly as typed,
   * with no date, and reset the input. */
  async function saveAsTyped(
    rawTitle: string,
    snapshot: { tagChips: Tag[]; listChip: TaskList[]; priorityChip: Priority[] },
  ): Promise<void> {
    await finalizeCreate(rawTitle, {}, snapshot);
    resetInput(rawTitle, snapshot);
  }

  /** Explicit discard (Escape, or the dismiss button): saves the task
   * exactly as typed, with no date — Assist only ever adds value, never
   * subtracts it. */
  async function discardDraft(): Promise<void> {
    if (draft === null) {
      return;
    }
    await saveAsTyped(draft.typedTitle, {
      tagChips: draft.tagChips,
      listChip: draft.listChip,
      priorityChip: draft.priorityChip,
    });
  }

  /** Per-chip removal (issue #47): drops one field from the draft before
   * confirming. `restoreTitle` always falls back to the full typed text —
   * the words a chip's phrase consumed aren't tracked individually on the
   * frontend, and the acceptance criteria allow this coarser fallback so a
   * removal never silently loses typed meaning. */
  function removeDraftField(update: (current: CaptureDraft) => CaptureDraft): void {
    setDraft((current) =>
      current === null ? null : update({ ...current, suggestedTitle: current.typedTitle }),
    );
  }

  function removeDateChip(): void {
    // A date-less Task can't recur or hold reminders (backend invariant),
    // so removing the date chip drops those dependent chips too.
    removeDraftField((current) => ({
      ...current,
      dueDate: null,
      isAllDay: false,
      timeZone: null,
      recurrence: null,
      reminders: [],
    }));
  }

  function removeRecurrenceChip(): void {
    removeDraftField((current) => ({ ...current, recurrence: null }));
  }

  function removeReminderChip(offset: string): void {
    removeDraftField((current) => ({
      ...current,
      reminders: current.reminders.filter((r) => r !== offset),
    }));
  }

  function removeListChip(): void {
    removeDraftField((current) => ({ ...current, suggestedListName: null }));
  }

  function removeTagChip(name: string): void {
    removeDraftField((current) => ({
      ...current,
      suggestedTagNames: current.suggestedTagNames.filter((n) => !sameName(n, name)),
    }));
  }

  function removePriorityChip(): void {
    removeDraftField((current) => ({ ...current, suggestedPriority: null }));
  }

  /** The confirmation beat's Enter: creates the Task from the proposed
   * title and resolved date. */
  async function confirmDraft(): Promise<void> {
    if (draft === null) {
      return;
    }
    const schedule = {
      ...(draft.dueDate === null ? {} : { due_date: draft.dueDate, is_all_day: draft.isAllDay }),
      ...(draft.timeZone === null ? {} : { time_zone: draft.timeZone }),
      ...(draft.recurrence === null ? {} : { recurrence: draft.recurrence }),
      ...(draft.reminders.length === 0 ? {} : { reminders: draft.reminders }),
    };
    const snapshot = {
      tagChips: draft.tagChips,
      listChip: draft.listChip,
      priorityChip: draft.priorityChip,
    };
    await finalizeCreate(draft.suggestedTitle, schedule, snapshot, {
      tokenTagNames: draft.tokenTagNames,
      tokenListId: draft.tokenListId,
      tokenPriority: draft.tokenPriority,
      suggestedListName: draft.suggestedListName,
      suggestedTagNames: draft.suggestedTagNames,
      suggestedPriority: draft.suggestedPriority,
    });
    resetInput(draft.typedTitle, snapshot);
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    // The draft row has no text input, so its Enter is handled by
    // onKeyDown below, not this native form-submit path — but guard here
    // too in case a submit event ever reaches this while a draft is up.
    if (draft !== null) {
      await confirmDraft();
      return;
    }
    const tokenPlan = parseQuickAdd(title, lists, {
      skipListToken: listChip.length > 0,
      skipPriorityToken: priorityChip.length > 0,
    });
    if (tokenPlan.title === "") {
      return;
    }
    // Snapshots so a chip or title edit made while this submission is still
    // awaiting the network isn't wiped out by the reset below.
    const submittedTitle = title;
    const snapshot = { tagChips, listChip, priorityChip };
    if (!assistAvailable) {
      await saveAsTyped(submittedTitle, snapshot);
      return;
    }
    // Assisted Capture: exactly one parse per submit, backstopped by a
    // client-enforced timeout on top of the backend's own — any failure
    // here silently degrades to plain capture, never a blocking error.
    // Explicit #tag/~list/!priority tokens are parsed client-side first
    // (issue #45): only the residual text — with those tokens already
    // stripped — is ever sent to the parse endpoint, and the tokens
    // themselves (tokenPlan) are carried through the draft so they still
    // outrank whatever Assist proposes for the same fields on confirm.
    setParsing(true);
    try {
      const suggestion = await parseCaptureWithTimeout(tokenPlan.title, lists, tags);
      if (suggestion === null) {
        // Parse failure or timeout: degrade to plain capture, no error shown.
        await saveAsTyped(submittedTitle, snapshot);
        return;
      }
      const hasSuggestion =
        suggestion.due_date !== null ||
        suggestion.list_name !== null ||
        suggestion.tag_names.length > 0 ||
        suggestion.priority !== null;
      if (!hasSuggestion) {
        // Empty extraction, or every phrase resolved to nothing: nothing
        // to confirm, so save as typed rather than open a beat with no
        // chip to show.
        await saveAsTyped(submittedTitle, snapshot);
        return;
      }
      const suggestedTitle = suggestion.title.trim() === "" ? submittedTitle : suggestion.title;
      setDraft({
        typedTitle: submittedTitle,
        ...snapshot,
        suggestedTitle,
        dueDate: suggestion.due_date,
        isAllDay: suggestion.is_all_day,
        timeZone: suggestion.time_zone,
        recurrence: suggestion.recurrence,
        reminders: suggestion.reminders,
        tokenTagNames: tokenPlan.tagNames,
        tokenListId: tokenPlan.listId,
        tokenPriority: tokenPlan.priority,
        suggestedListName: suggestion.list_name,
        suggestedTagNames: suggestion.tag_names,
        suggestedPriority: suggestion.priority,
      });
    } catch {
      // A throw from the create call on the no-date/empty-suggestion paths
      // above: degrade to plain capture, no error shown.
      await saveAsTyped(submittedTitle, snapshot);
    } finally {
      setParsing(false);
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLFormElement>): void {
    if (draft === null) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      void discardDraft();
    } else if (event.key === "Enter" && event.target === draftRef.current) {
      // Enter on a chip's own remove button activates that button instead
      // (native keyboard behavior) — only Enter on the draft row itself
      // confirms, so removing a chip with the keyboard never also confirms.
      event.preventDefault();
      void confirmDraft();
    }
  }

  const tagChannel: TokenChannel<Tag> = {
    sigil: "#",
    mode: "multi",
    chips: tagChips,
    onChipsChange: setTagChips,
    getId: (tag) => tag.id,
    getLabel: (tag) => tag.name,
    suggest: (text, caret) => suggestTags(text, caret, tags),
    applyPick: applyTagPick,
    allowCreate: true,
    onCreate: (name) => createTag({ name }),
    onCreated: onTagCreated,
    createLabel: (name) => `Create tag "${name}"`,
    removeAriaLabel: (tag) => `Remove ${tag.name}`,
  };

  const listChannel: TokenChannel<TaskList> = {
    sigil: "~",
    mode: "single",
    chips: listChip,
    onChipsChange: setListChip,
    getId: (list) => list.id,
    getLabel: (list) => list.name,
    suggest: (text, caret) => suggestLists(text, caret, lists),
    applyPick: applyListPick,
    allowCreate: true,
    onCreate: (name) => createList({ name }),
    onCreated: onListCreated,
    createLabel: (name) => `Create list "${name}"`,
    removeAriaLabel: (list) => `Remove ${list.name}`,
  };

  const priorityChannel: TokenChannel<Priority> = {
    sigil: "!",
    mode: "single",
    chips: priorityChip,
    onChipsChange: setPriorityChip,
    getId: (priority) => priority,
    getLabel: (priority) => PRIORITY_LABELS[priority],
    suggest: (text, caret) => suggestPriority(text, caret),
    applyPick: applyPriorityPick,
    allowCreate: false,
    createLabel: (name) => name,
    removeAriaLabel: (priority) => `Remove ${priority}`,
  };

  return (
    <form onSubmit={(event) => void submit(event)} onKeyDown={onKeyDown}>
      {draft !== null ? (
        <div
          ref={draftRef}
          tabIndex={-1}
          className="token-input quick-add-assist-draft"
          role="group"
          aria-label="Assisted Capture draft"
        >
          <span className="tag-chip token-chip">{draft.suggestedTitle}</span>
          {draft.dueDate !== null && (
            <span className="date-chip token-chip">
              {formatDraftDate(draft.dueDate, draft.isAllDay)}
              <button type="button" aria-label="Remove date" onClick={removeDateChip}>
                <Icon name="x" size={12} />
              </button>
            </span>
          )}
          {draft.recurrence !== null && (
            <span className="date-chip token-chip">
              {formatRecurrenceRule(draft.recurrence)}
              <button type="button" aria-label="Remove recurrence" onClick={removeRecurrenceChip}>
                <Icon name="x" size={12} />
              </button>
            </span>
          )}
          {draft.reminders.map((offset) => (
            <span key={offset} className="date-chip token-chip">
              {formatReminderOffset(offset)}
              <button
                type="button"
                aria-label={`Remove reminder (${formatReminderOffset(offset)})`}
                onClick={() => removeReminderChip(offset)}
              >
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
          {draft.tokenListId !== null && (
            <span className="list-chip token-chip">
              {lists.find((list) => list.id === draft.tokenListId)?.name ?? ""}
            </span>
          )}
          {draft.suggestedListName !== null &&
            draft.tokenListId === null &&
            draft.listChip.length === 0 && (
              <span className="list-chip token-chip">
                {draft.suggestedListName}
                <button type="button" aria-label="Remove list" onClick={removeListChip}>
                  <Icon name="x" size={12} />
                </button>
              </span>
            )}
          {draft.tokenTagNames.map((name) => (
            <span key={name} className="tag-chip token-chip">
              #{name}
            </span>
          ))}
          {draft.suggestedTagNames
            .filter(
              (name) =>
                draft.tagChips.length === 0 &&
                !draft.tokenTagNames.some((tokenName) => sameName(tokenName, name)),
            )
            .map((name) => (
              <span key={name} className="tag-chip token-chip">
                #{name}
                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  onClick={() => removeTagChip(name)}
                >
                  <Icon name="x" size={12} />
                </button>
              </span>
            ))}
          {draft.tokenPriority !== null && (
            <span className="tag-chip token-chip">{PRIORITY_LABELS[draft.tokenPriority]}</span>
          )}
          {draft.suggestedPriority !== null &&
            draft.tokenPriority === null &&
            draft.priorityChip.length === 0 && (
              <span className="tag-chip token-chip">
                {PRIORITY_LABELS[draft.suggestedPriority]}
                <button type="button" aria-label="Remove priority" onClick={removePriorityChip}>
                  <Icon name="x" size={12} />
                </button>
              </span>
            )}
          <span className="quick-add-assist-hint">Enter to confirm · Esc to discard</span>
          <button
            type="button"
            className="quick-add-assist-discard"
            aria-label="Discard suggestion"
            onClick={() => void discardDraft()}
          >
            <Icon name="x" size={12} />
          </button>
        </div>
      ) : (
        <TokenInput
          ariaLabel="Add a task"
          placeholder={placeholder}
          value={title}
          onValueChange={setTitle}
          channels={[
            tagChannel as TokenChannel<unknown>,
            listChannel as TokenChannel<unknown>,
            priorityChannel as TokenChannel<unknown>,
          ]}
          trailingContent={
            parsing ? (
              <span className="quick-add-assist-busy" aria-label="Assist is parsing" role="status">
                <Icon name="sparkles" size={16} />
              </span>
            ) : (
              assistAvailable && (
                <span
                  className="quick-add-assist-affordance"
                  aria-label="Assist available"
                  title="Assist"
                >
                  <Icon name="sparkles" size={16} />
                </span>
              )
            )
          }
        />
      )}
    </form>
  );
}
