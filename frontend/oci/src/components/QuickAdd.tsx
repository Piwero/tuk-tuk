import { useEffect, useRef, useState } from "react";

import {
  createList,
  createTag,
  createTask,
  parseAssistCapture,
  type Priority,
  type Tag,
  type Task,
  type TaskList,
} from "../api";
import { PRIORITY_LABELS } from "../grouping";
import { applyListPick, suggestLists } from "../listSuggest";
import { applyPriorityPick, suggestPriority } from "../prioritySuggest";
import { parseQuickAdd, sameName } from "../quickAdd";
import { applyTagPick, suggestTags } from "../tagSuggest";
import { useAssistAvailable } from "../useAssistAvailable";
import { Icon } from "./Icon";
import { TokenInput, type TokenChannel } from "./TokenInput";

/** A client-enforced backstop on top of the backend's own parse timeout
 * (issue #43): Assist only ever adds value, never subtracts it, so a slow
 * or hung parse must never hold Quick-Add's Enter beyond a couple of
 * seconds. */
const PARSE_TIMEOUT_MS = 5000;

/** The caller's own local day as YYYY-MM-DD — what a relative date phrase
 * ("tomorrow", "tuesday") resolves against, server-side. */
function localDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

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
 * creates the Task from `proposedTitle` + the resolved date; discarding
 * (Escape / the dismiss button) creates it from `typedTitle` instead, with
 * no date — "exactly as typed". */
interface CaptureDraft {
  typedTitle: string;
  tagChips: Tag[];
  listChip: TaskList[];
  priorityChip: Priority[];
  proposedTitle: string;
  dueDate: string;
  isAllDay: boolean;
  timeZone: string | null;
  // RRULE content and reminder offsets resolved from recurrence/reminder
  // phrases (issue #44) — rendered as their own chips, confirmed straight
  // through to Task.recurrence/Task.reminders on the create call.
  recurrence: string | null;
  reminders: string[];
}

const FREQ_LABELS: Record<string, string> = {
  DAILY: "daily",
  WEEKLY: "weekly",
  MONTHLY: "monthly",
  YEARLY: "yearly",
};

const FREQ_UNIT_PLURALS: Record<string, string> = {
  DAILY: "days",
  WEEKLY: "weeks",
  MONTHLY: "months",
  YEARLY: "years",
};

const BYDAY_LABELS: Record<string, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};

/** A human-readable label for the RRULE content Assisted Capture's own
 * recurrence-phrase resolver emits (app.recurrence_phrase); anything this
 * doesn't recognize falls back to the raw rule so the chip never goes
 * blank. */
function formatRecurrenceRule(recurrence: string): string {
  const parts = Object.fromEntries(
    recurrence.split(";").map((part) => part.split("=") as [string, string]),
  );
  const freq = parts.FREQ;
  if (freq === undefined) {
    return recurrence;
  }
  if (parts.BYMONTHDAY !== undefined) {
    return `monthly on the ${parts.BYMONTHDAY}${dayOrdinalSuffix(Number(parts.BYMONTHDAY))}`;
  }
  if (parts.BYDAY !== undefined) {
    const days = parts.BYDAY.split(",")
      .map((code) => BYDAY_LABELS[code] ?? code)
      .join(", ");
    return `weekly on ${days}`;
  }
  if (parts.INTERVAL !== undefined) {
    return `every ${parts.INTERVAL} ${FREQ_UNIT_PLURALS[freq] ?? freq.toLowerCase()}`;
  }
  return FREQ_LABELS[freq] ?? freq.toLowerCase();
}

function dayOrdinalSuffix(day: number): string {
  if (day % 10 === 1 && day !== 11) return "st";
  if (day % 10 === 2 && day !== 12) return "nd";
  if (day % 10 === 3 && day !== 13) return "rd";
  return "th";
}

/** A human-readable label for a reminder's signed ISO-8601 duration offset
 * (the wire format Task.reminders already uses). Only the closed set
 * Assisted Capture's own reminder-phrase resolver ever emits is rendered
 * specially; anything else falls back to the raw offset so the chip never
 * goes blank. */
function formatReminderOffset(offset: string): string {
  if (offset === "PT0S") {
    return "at the time";
  }
  const daysMatch = /^-P(\d+)D$/.exec(offset);
  if (daysMatch !== null) {
    const n = Number(daysMatch[1]);
    return n === 1 ? "1 day before" : `${n} days before`;
  }
  const hoursMatch = /^-PT(\d+)H$/.exec(offset);
  if (hoursMatch !== null) {
    const n = Number(hoursMatch[1]);
    return n === 1 ? "1 hour before" : `${n} hours before`;
  }
  const minutesMatch = /^-PT(\d+)M$/.exec(offset);
  if (minutesMatch !== null) {
    const n = Number(minutesMatch[1]);
    return n === 1 ? "1 minute before" : `${n} minutes before`;
  }
  return offset;
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
    // Chips and any raw #tokens left in the title are unioned and
    // deduplicated case-insensitively by name — a chip and a typed token can
    // both name the same tag. Unknown names create the Tag on the fly.
    const tagIds: number[] = [];
    const seen: string[] = [];
    for (const chip of snapshot.tagChips) {
      if (!seen.some((name) => sameName(name, chip.name))) {
        seen.push(chip.name);
        tagIds.push(chip.id);
      }
    }
    for (const name of plan.tagNames) {
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
    const finalListId = snapshot.listChip[0]?.id ?? plan.listId ?? listId;
    const finalPriority = snapshot.priorityChip[0] ?? plan.priority;
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

  /** The confirmation beat's Enter: creates the Task from the proposed
   * title and resolved date. */
  async function confirmDraft(): Promise<void> {
    if (draft === null) {
      return;
    }
    const schedule = {
      due_date: draft.dueDate,
      is_all_day: draft.isAllDay,
      ...(draft.timeZone === null ? {} : { time_zone: draft.timeZone }),
      ...(draft.recurrence === null ? {} : { recurrence: draft.recurrence }),
      ...(draft.reminders.length === 0 ? {} : { reminders: draft.reminders }),
    };
    const snapshot = {
      tagChips: draft.tagChips,
      listChip: draft.listChip,
      priorityChip: draft.priorityChip,
    };
    await finalizeCreate(draft.proposedTitle, schedule, snapshot);
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
    const plan = parseQuickAdd(title, lists, {
      skipListToken: listChip.length > 0,
      skipPriorityToken: priorityChip.length > 0,
    });
    if (plan.title === "") {
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
    setParsing(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), PARSE_TIMEOUT_MS);
    try {
      const proposal = await parseAssistCapture(
        {
          text: submittedTitle,
          local_date: localDateString(),
          time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        controller.signal,
      );
      if (proposal.due_date === null) {
        // Empty extraction, or a phrase that resolved to nothing: nothing
        // to confirm, so save as typed rather than open a beat with no
        // date chip to show.
        await saveAsTyped(submittedTitle, snapshot);
        return;
      }
      const proposedTitle = proposal.title.trim() === "" ? submittedTitle : proposal.title;
      setDraft({
        typedTitle: submittedTitle,
        ...snapshot,
        proposedTitle,
        dueDate: proposal.due_date,
        isAllDay: proposal.is_all_day,
        timeZone: proposal.time_zone,
        recurrence: proposal.recurrence,
        reminders: proposal.reminders,
      });
    } catch {
      // Parse failure or timeout: degrade to plain capture, no error shown.
      await saveAsTyped(submittedTitle, snapshot);
    } finally {
      window.clearTimeout(timeoutId);
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
    } else if (event.key === "Enter") {
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
          <span className="tag-chip token-chip">{draft.proposedTitle}</span>
          <span className="date-chip token-chip">
            {formatDraftDate(draft.dueDate, draft.isAllDay)}
          </span>
          {draft.recurrence !== null && (
            <span className="date-chip token-chip">{formatRecurrenceRule(draft.recurrence)}</span>
          )}
          {draft.reminders.map((offset) => (
            <span key={offset} className="date-chip token-chip">
              {formatReminderOffset(offset)}
            </span>
          ))}
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
