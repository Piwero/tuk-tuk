import { useState } from "react";

import {
  createTag,
  createTask,
  type Priority,
  type Tag,
  type Task,
  type TaskCreateInput,
  type TaskList,
} from "../api";
import {
  dateDraftFromAssist,
  formatRecurrenceRule,
  formatReminderOffset,
  parseCaptureWithTimeout,
} from "../assistCapture";
import { resolveTokenSchedule, type ScheduleChip } from "../dateSuggest";
import {
  addDays,
  browserTimeZone,
  emptyDraft,
  localDayOf,
  nextMonday,
  scheduleForCreate,
  scheduleFromDraft,
  type DateDraft,
} from "../dates";
import {
  makeDateChannel,
  makeListChannel,
  makePriorityChannel,
  makeTagChannel,
} from "../captureChannels";
import { PRIORITY_LABELS } from "../grouping";
import { parseQuickAdd, sameName } from "../quickAdd";
import { useAssistAvailable } from "../useAssistAvailable";
import { DateFieldset } from "./DateFieldset";
import { Hint } from "./Hint";
import { Icon } from "./Icon";
import { TokenInput, type TokenChannel } from "./TokenInput";

/** A resolved `@` schedule chip as a Task create payload. */
function chipCreate(chip: ScheduleChip): Partial<TaskCreateInput> {
  return {
    due_date: chip.dueDate,
    is_all_day: chip.isAllDay,
    ...(chip.timeZone === null ? {} : { time_zone: chip.timeZone }),
  };
}

interface QuickAddDialogProps {
  lists: TaskList[];
  tags: Tag[];
  /** The viewed List, or null on a view that isn't one List (Inbox then). */
  defaultListId: number | null;
  onTagCreated: (tag: Tag) => void;
  onListCreated: (list: TaskList) => void;
  onCreated: (task: Task) => void;
  onClose: () => void;
}

/** The full capture form behind the header's Quick add button: everything the
 * one-line Quick-Add bar can't express, filled in before the task exists.
 *
 * The title takes the same `#tag` / `!priority` / `~list` tokens as the bar,
 * but a pick lands in this form's own List/Priority/Tags controls rather than
 * a chip row — one visible source of truth per field, so the two can't
 * disagree about what the task will be.
 *
 * Assisted Capture (ADR 0005; CONTEXT.md) rides that same principle: when
 * Assist is available, the first "Add task" click parses the typed title
 * into these very controls — the recognised phrase leaves the title, the
 * date lands in the Date fieldset, a matched List/Priority/Tag lands in its
 * control — and saves nothing. The now-populated form *is* the one
 * confirmation beat: the user reviews it and clicks "Add task" again to
 * save. Recurrence and reminder phrases, which have no control here, show as
 * removable chips. Assist only ever adds value: an unavailable Ollama, a
 * parse that extracts nothing, a failure, or a timeout all just save the
 * task in the single click, exactly as this dialog behaved before.
 */
export function QuickAddDialog({
  lists,
  tags,
  defaultListId,
  onTagCreated,
  onListCreated,
  onCreated,
  onClose,
}: QuickAddDialogProps): JSX.Element {
  const inboxId = lists.find((list) => list.is_inbox)?.id ?? lists[0]?.id ?? null;
  const [title, setTitle] = useState("");
  const [listId, setListId] = useState<number | null>(defaultListId ?? inboxId);
  const [priority, setPriority] = useState<Priority>("none");
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [newTag, setNewTag] = useState("");
  const [dateDraft, setDateDraft] = useState<DateDraft>(emptyDraft);
  // The `@day` schedule chip, tracked so the dropdown's "already picked"
  // dedupe still works — but a pick lands in the Date fieldset below (one
  // visible source of truth per field), never in a chip row.
  const [scheduleChip, setScheduleChip] = useState<ScheduleChip[]>([]);
  // The clock every `@day` token resolves against — read once per render so
  // the dropdown and the submit-time parse always agree.
  const now = new Date();
  // Whether the List / Priority now shown was chosen by the user — through
  // the select or a dropdown pick — rather than left at its default. A raw
  // `~list` / `!priority` token still sitting in the title only claims a
  // field that nobody chose, mirroring how a chip wins in the bar.
  const [listChosen, setListChosen] = useState(false);
  const [priorityChosen, setPriorityChosen] = useState(false);
  // ADR 0005: invisible, not greyed out, when Ollama isn't reachable.
  const assistAvailable = useAssistAvailable();
  // True while the one parse an "Add task" triggers is in flight — the
  // title field's busy indicator.
  const [parsing, setParsing] = useState(false);
  // True once a parse has populated this form: the next "Add task" then
  // saves rather than parsing again.
  const [assistApplied, setAssistApplied] = useState(false);
  // Recurrence / reminder phrases Assist resolved (issue #44): this dialog
  // has no control for either, so they show as removable chips and ride the
  // create call only alongside a resolved date.
  const [recurrence, setRecurrence] = useState<string | null>(null);
  const [reminders, setReminders] = useState<string[]>([]);

  /** A title edit re-arms Assist: the next "Add task" parses the new text
   * rather than saving stale suggestions, keeping the behaviour "parse on
   * submit" exactly as in the bar. Any recurrence / reminder chips from the
   * previous parse go with it — they're Assist-only artifacts with no
   * control of their own, so a fresh parse must own them outright. */
  function onTitleChange(next: string): void {
    setTitle(next);
    if (assistApplied) {
      setAssistApplied(false);
      setRecurrence(null);
      setReminders([]);
    }
  }

  /** A quick pick sets the day and leaves the times alone — an untimed day is
   * an all-day task, exactly as in the detail panel. */
  function pickDay(dayIso: string): void {
    setDateDraft((current) => ({ ...current, dueDay: dayIso }));
    setScheduleChip([]);
  }

  function toggleTag(tagId: number): void {
    setTagIds((current) =>
      current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId],
    );
  }

  function removeReminder(offset: string): void {
    setReminders((current) => current.filter((r) => r !== offset));
  }

  /** Editing the date away takes the Assist recurrence / reminder chips with
   * it — neither can attach to a dateless Task (backend invariant), so a
   * visible chip that would be silently dropped at save must not survive. */
  function changeDate(next: DateDraft): void {
    setDateDraft(next);
    // Any hand-edit of the fieldset supersedes a standing `@` pick — the
    // fieldset is now the source of truth, so the picked chip must not
    // re-compose over it at submit.
    setScheduleChip([]);
    if (next.dueDay === "" && (recurrence !== null || reminders.length > 0)) {
      setRecurrence(null);
      setReminders([]);
    }
  }

  /** An `@` pick (or merge) lands in the Date fieldset: the picked
   * ScheduleChip becomes the dateDraft — its day, plus a due time when the
   * chip carries a clock time. The chip itself is kept in state only so the
   * dropdown's already-picked dedupe keeps working; nothing renders it. */
  function onScheduleChips(chips: ScheduleChip[]): void {
    setScheduleChip(chips);
    const chip = chips[0];
    if (chip === undefined) {
      setDateDraft(emptyDraft());
      return;
    }
    setDateDraft(dateDraftFromAssist({ due_date: chip.dueDate, is_all_day: chip.isAllDay }));
  }

  /** One Assisted Capture parse of the residual title (tokens already
   * stripped by `plan`), applied to this form's controls. Returns true when
   * a control actually changed — the caller then leaves the dialog open for
   * the confirmation click — and false when there was nothing to apply
   * (every suggested field was already claimed, or the parse failed), so
   * the caller falls through to an immediate save. A suggestion never
   * overrides a field the user already claimed with the control or an
   * explicit token: token-derived and hand-chosen fields both outrank the
   * model (CONTEXT.md's Assist glossary). */
  async function runAssist(plan: ReturnType<typeof parseQuickAdd>): Promise<boolean> {
    setParsing(true);
    try {
      const suggestion = await parseCaptureWithTimeout(plan.title, lists, tags);
      if (suggestion === null) {
        return false;
      }
      // A day already in the Date fieldset is the user's — Assist fills that
      // control, it never overwrites a hand-entered date, and it leaves an
      // untouched fieldset alone rather than wiping it.
      const dateTouched = dateDraft.dueDay !== "" || scheduleChip.length > 0 || plan.due !== null;
      const willApplyDate = suggestion.due_date !== null && !dateTouched;
      // Recurrence / reminders can only attach to a dated Task (backend
      // invariant), so they apply only when a date will be present.
      const willHaveDate = willApplyDate || dateTouched;
      const willApplyRecurrence = suggestion.recurrence !== null && willHaveDate;
      const willApplyReminders = suggestion.reminders.length > 0 && willHaveDate;
      const matchedListId =
        suggestion.list_name == null
          ? null
          : (lists.find((list) => sameName(list.name, suggestion.list_name as string))?.id ?? null);
      const willApplyList = matchedListId !== null && !listChosen && plan.listId === null;
      const willApplyPriority =
        suggestion.priority !== null &&
        suggestion.priority !== "none" &&
        !priorityChosen &&
        plan.priority === null;
      // Assist's tags, like the bar's, apply only when the user named none
      // themselves — never overriding a hand-ticked or `#token` set.
      const suggestedTagIds =
        tagIds.length === 0 && plan.tagNames.length === 0
          ? suggestion.tag_names
              .map((name) => tags.find((tag) => sameName(tag.name, name))?.id)
              .filter((id): id is number => id !== undefined)
          : [];

      if (
        !willApplyDate &&
        !willApplyRecurrence &&
        !willApplyReminders &&
        !willApplyList &&
        !willApplyPriority &&
        suggestedTagIds.length === 0
      ) {
        return false;
      }

      const strippedTitle = suggestion.title.trim();
      setTitle(strippedTitle === "" ? plan.title.trim() : strippedTitle);
      if (willApplyDate) {
        setDateDraft(dateDraftFromAssist(suggestion));
      }
      setRecurrence(willApplyRecurrence ? suggestion.recurrence : null);
      setReminders(willApplyReminders ? suggestion.reminders : []);
      if (willApplyList) {
        setListId(matchedListId);
        setListChosen(true);
      }
      if (willApplyPriority) {
        setPriority(suggestion.priority as Priority);
        setPriorityChosen(true);
      }
      if (suggestedTagIds.length > 0) {
        setTagIds((current) => [...new Set([...current, ...suggestedTagIds])]);
      }
      setAssistApplied(true);
      return true;
    } finally {
      setParsing(false);
    }
  }

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (parsing) {
      return;
    }
    // Tokens typed but never picked from the dropdown are still honoured at
    // submit, exactly as in the bar — otherwise a fully-typed `~expenses`
    // would be saved as literal title text.
    // `@` tokens are always parsed out of the title (so a fully-typed
    // `@tomorrow` never lands as literal text), but a date already in the
    // fieldset — hand-set or from an earlier `@` pick — outranks `plan.due`
    // below, mirroring how a chip wins in the bar.
    const plan = parseQuickAdd(title, lists, {
      skipListToken: listChosen,
      skipPriorityToken: priorityChosen,
      skipDateToken: scheduleChip.length > 0,
      now,
    });
    const trimmed = plan.title.trim();
    if (trimmed === "") {
      return;
    }
    // First submit with Assist available: parse into the form and wait for
    // the confirmation click. A parse that applies nothing (or fails) falls
    // straight through to the save below, so Assist never costs a click.
    if (assistAvailable && !assistApplied && (await runAssist(plan))) {
      return;
    }
    // A typed name that matches nothing creates the Tag first — the same
    // on-the-fly rule the Quick-Add bar applies to an unknown #tag.
    const chosen = [...tagIds];
    for (const name of plan.tagNames) {
      const existing = tags.find((tag) => sameName(tag.name, name));
      if (existing !== undefined) {
        if (!chosen.includes(existing.id)) {
          chosen.push(existing.id);
        }
      } else {
        const created = await createTag({ name });
        onTagCreated(created);
        chosen.push(created.id);
      }
    }
    const wanted = newTag.trim();
    if (wanted !== "") {
      const existing = tags.find((tag) => sameName(tag.name, wanted));
      if (existing !== undefined) {
        if (!chosen.includes(existing.id)) {
          chosen.push(existing.id);
        }
      } else {
        const created = await createTag({ name: wanted });
        onTagCreated(created);
        chosen.push(created.id);
      }
    }
    const finalListId = listChosen ? listId : (plan.listId ?? listId);
    const finalPriority = priorityChosen ? priority : (plan.priority ?? priority);
    // Precedence, mirroring the bar's `resolveTokenSchedule`: a picked `@`
    // chip owns the day and composes with any raw clock time typed after it;
    // failing that the fieldset (hand-set, or a quick-pick button) wins;
    // failing that a raw `@tomorrow` typed but never picked resolves here.
    const draftSchedule = scheduleFromDraft(dateDraft);
    let scheduleCreate: Partial<TaskCreateInput> | null;
    if (scheduleChip.length > 0) {
      const due = resolveTokenSchedule(scheduleChip[0], plan.due, plan.dueTime, browserTimeZone());
      scheduleCreate = due === null ? null : chipCreate(due);
    } else if (draftSchedule !== null) {
      scheduleCreate = scheduleForCreate(draftSchedule);
    } else {
      scheduleCreate = plan.due === null ? null : chipCreate(plan.due);
    }
    const task = await createTask({
      title: trimmed,
      ...(finalListId === null ? {} : { list_id: finalListId }),
      ...(finalPriority === "none" ? {} : { priority: finalPriority }),
      ...(chosen.length === 0 ? {} : { tag_ids: chosen }),
      ...(scheduleCreate === null ? {} : scheduleCreate),
      // Recurrence and reminders can't attach to a dateless Task (backend
      // invariant), so they ride only alongside a resolved schedule.
      ...(scheduleCreate !== null && recurrence !== null ? { recurrence } : {}),
      ...(scheduleCreate !== null && reminders.length > 0 ? { reminders } : {}),
    });
    onCreated(task);
    onClose();
  }

  // Each channel's "chips" are read straight off the form's own state, so a
  // pick is indistinguishable from having used the control by hand, and the
  // already-picked check the dropdown does still works.
  const tagChannel = makeTagChannel(
    tags,
    tags.filter((tag) => tagIds.includes(tag.id)),
    (chips) => setTagIds(chips.map((tag) => tag.id)),
    onTagCreated,
  );
  const listChannel = makeListChannel(
    lists,
    lists.filter((list) => list.id === listId),
    (chips) => {
      setListId(chips[0]?.id ?? null);
      setListChosen(true);
    },
    onListCreated,
  );
  const priorityChannel = makePriorityChannel(priority === "none" ? [] : [priority], (chips) => {
    setPriority(chips[0] ?? "none");
    setPriorityChosen(true);
  });
  const dateChannel = makeDateChannel(scheduleChip, onScheduleChips, now);

  return (
    <form className="quick-add-dialog" onSubmit={(event) => void submit(event)}>
      <label>
        Title
        <TokenInput
          ariaLabel="Title"
          placeholder="What needs doing?"
          value={title}
          onValueChange={onTitleChange}
          channels={[
            tagChannel as TokenChannel<unknown>,
            listChannel as TokenChannel<unknown>,
            priorityChannel as TokenChannel<unknown>,
            dateChannel as TokenChannel<unknown>,
          ]}
          showChips={false}
          autoFocus
          trailingContent={
            parsing ? (
              <span className="quick-add-assist-busy" aria-label="Assist is parsing" role="status">
                <Icon name="sparkles" size={16} />
              </span>
            ) : (
              assistAvailable && (
                <Hint hintKey="assisted-capture">
                  <span
                    className="quick-add-assist-affordance"
                    aria-label="Assist available"
                    tabIndex={0}
                  >
                    <Icon name="sparkles" size={16} />
                  </span>
                </Hint>
              )
            )
          }
        />
      </label>
      <label>
        List
        <select
          aria-label="List"
          value={listId ?? ""}
          onChange={(event) => {
            setListId(Number(event.target.value));
            setListChosen(true);
          }}
        >
          {lists.map((list) => (
            <option key={list.id} value={list.id}>
              {list.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Priority
        <select
          aria-label="Priority"
          value={priority}
          onChange={(event) => {
            setPriority(event.target.value as Priority);
            setPriorityChosen(true);
          }}
        >
          {(Object.keys(PRIORITY_LABELS) as Priority[]).map((level) => (
            <option key={level} value={level}>
              {PRIORITY_LABELS[level]}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="quick-add-dates">
        <legend>Date</legend>
        <div className="date-actions">
          <button type="button" onClick={() => pickDay(localDayOf(new Date()))}>
            Today
          </button>
          <button type="button" onClick={() => pickDay(addDays(localDayOf(new Date()), 1))}>
            Tomorrow
          </button>
          <button type="button" onClick={() => pickDay(nextMonday(localDayOf(new Date())))}>
            Next Week
          </button>
          <button type="button" onClick={() => changeDate(emptyDraft())}>
            Clear date
          </button>
        </div>
        <DateFieldset draft={dateDraft} onChange={changeDate} />
        {(recurrence !== null || reminders.length > 0) && (
          <div className="quick-add-assist-chips" role="group" aria-label="Assist suggestions">
            {recurrence !== null && (
              <span className="date-chip token-chip">
                {formatRecurrenceRule(recurrence)}
                <button
                  type="button"
                  aria-label="Remove recurrence"
                  onClick={() => setRecurrence(null)}
                >
                  <Icon name="x" size={12} />
                </button>
              </span>
            )}
            {reminders.map((offset) => (
              <span key={offset} className="date-chip token-chip">
                {formatReminderOffset(offset)}
                <button
                  type="button"
                  aria-label={`Remove reminder (${formatReminderOffset(offset)})`}
                  onClick={() => removeReminder(offset)}
                >
                  <Icon name="x" size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
      </fieldset>
      <fieldset className="quick-add-tags">
        <legend>Tags</legend>
        {tags.map((tag) => (
          <label key={tag.id}>
            <input
              type="checkbox"
              aria-label={tag.name}
              checked={tagIds.includes(tag.id)}
              onChange={() => toggleTag(tag.id)}
            />
            {tag.name}
          </label>
        ))}
        <label>
          New tag
          <input
            aria-label="New tag"
            placeholder="Create a tag…"
            value={newTag}
            onChange={(event) => setNewTag(event.target.value)}
          />
        </label>
      </fieldset>
      <div className="quick-add-dialog-actions">
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        <button type="submit">Add task</button>
      </div>
    </form>
  );
}
