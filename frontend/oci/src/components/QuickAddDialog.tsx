import "./QuickAddDialog.css";

import { useEffect, useId, useMemo, useRef, useState } from "react";

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
  formatSchedule,
  localDayOf,
  nextMonday,
  scheduleForCreate,
  scheduleFromDraft,
  shortDayLabel,
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
import {
  clearQuickAddDraft,
  isEmptyDraft,
  loadQuickAddDraft,
  saveQuickAddDraft,
  type QuickAddDraft,
} from "../quickAddDraft";
import { useAssistAvailable } from "../useAssistAvailable";
import { useUndoQueue } from "../undoQueue";
import { DateFieldset } from "./DateFieldset";
import { Hint } from "./Hint";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { ReminderDeliveryNote } from "./ReminderDeliveryNote";
import { ToastStack } from "./ToastStack";
import { TokenInput, type TokenChannel } from "./TokenInput";

/** A resolved `@` schedule chip as a Task create payload. */
function chipCreate(chip: ScheduleChip): Partial<TaskCreateInput> {
  return {
    due_date: chip.dueDate,
    is_all_day: chip.isAllDay,
    ...(chip.timeZone === null ? {} : { time_zone: chip.timeZone }),
  };
}

/** The date chip's text for a draft, worded as Task detail words it
 * ("Tomorrow", "Fri, 10:00"); null when no day is set. A draft the editor
 * can't save yet (a start after its due) still names its day. */
function draftLabel(draft: DateDraft, now: Date): string | null {
  if (draft.dueDay === "") {
    return null;
  }
  const schedule = scheduleFromDraft(draft);
  if (schedule === null) {
    return shortDayLabel(draft.dueDay);
  }
  return formatSchedule(
    {
      start_date: schedule.start_date ?? null,
      due_date: schedule.due_date ?? null,
      is_all_day: schedule.is_all_day ?? true,
    },
    "detail",
    now,
  );
}

interface QuickAddDialogProps {
  lists: TaskList[];
  tags: Tag[];
  /** The viewed List, or null on a view that isn't one List (Inbox then). */
  defaultListId: number | null;
  /** The signed-in User the unsent draft is kept for (#541); null while
   * not yet known, when nothing is kept or restored. */
  userId: number | null;
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
 * Title-first (#540): only the title, a summary and "Add task" show on
 * open. Those controls wait behind a "Details" disclosure; while it is
 * collapsed the summary names the destination (quietly "Inbox" by default)
 * and shows a removable chip for every field already set — the viewed List,
 * a picked token, an Assist suggestion — so nothing about the Task being
 * filed is hidden by collapsing.
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
 *
 * Session draft (#541): what was typed or chosen and not yet saved is kept
 * for the signed-in User in this tab's sessionStorage, so dismissing the
 * dialog any way at all loses nothing. Reopening restores it — its List and
 * date over the context the dialog opened with — and says "Draft restored".
 * A save clears it; a failed save keeps it; "Discard draft" drops it, with
 * the app's usual Undo toast to bring it back.
 */
export function QuickAddDialog(props: QuickAddDialogProps): React.JSX.Element {
  const { userId } = props;
  // Discarding starts a fresh form: remounting it resets every field to the
  // opening context and puts the caret back in the title in one move.
  const [generation, setGeneration] = useState(0);
  // The app's undo toasts sit under a Modal's scrim, out of reach of its Tab
  // trap, so the dialog keeps its own queue and stack inside the panel.
  const undo = useUndoQueue();

  function discard(draft: QuickAddDraft): void {
    setGeneration((current) => current + 1);
    if (userId === null) return;
    clearQuickAddDraft(userId);
    // Undo is "write it back and restore": the remounted form reads the
    // draft the way any reopen does, and says "Draft restored".
    undo.push(
      "Draft discarded",
      () => {},
      () => {
        saveQuickAddDraft(userId, draft);
        setGeneration((current) => current + 1);
      },
    );
  }

  return (
    <>
      <QuickAddForm key={generation} {...props} onDiscard={discard} />
      <ToastStack entries={undo.entries} onUndo={undo.undo} onDismiss={undo.dismiss} />
    </>
  );
}

/** One summary chip (#540): what a field is set to, and an "x" that takes
 * it away. `kind` picks the shared chip look the rest of the app gives that
 * field (a List, a Tag-like label, a schedule), as the command palette's
 * capture preview does. */
function RemovableChip({
  kind,
  removeLabel,
  onRemove,
  children,
}: {
  kind: "list" | "tag" | "date";
  removeLabel: string;
  onRemove: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <span className={`${kind}-chip token-chip`}>
      {children}
      <IconButton icon="x" size={12} label={removeLabel} onClick={onRemove} />
    </span>
  );
}

/** A stored draft, trimmed to what still exists: a List or Tag deleted since
 * it was typed is simply dropped. */
function restorableDraft(
  userId: number | null,
  lists: TaskList[],
  tags: Tag[],
): QuickAddDraft | null {
  const draft = userId === null ? null : loadQuickAddDraft(userId);
  if (draft === null) return null;
  return {
    ...draft,
    listId: lists.some((list) => list.id === draft.listId) ? draft.listId : null,
    tagIds: draft.tagIds.filter((id) => tags.some((tag) => tag.id === id)),
  };
}

function QuickAddForm({
  lists,
  tags,
  defaultListId,
  userId,
  onTagCreated,
  onListCreated,
  onCreated,
  onClose,
  onDiscard,
}: QuickAddDialogProps & { onDiscard: (draft: QuickAddDraft) => void }): React.JSX.Element {
  const inboxId = lists.find((list) => list.is_inbox)?.id ?? lists[0]?.id ?? null;
  // Read once, on open: the draft this User left unsent, if any.
  const [restored] = useState(() => restorableDraft(userId, lists, tags));
  const [title, setTitle] = useState(restored?.title ?? "");
  // Where a title goes when nobody picks a List: the viewed List, else Inbox.
  const homeListId = defaultListId ?? inboxId;
  // A List the draft chose wins over the one the dialog opened on.
  const [listId, setListId] = useState<number | null>(restored?.listId ?? homeListId);
  const [priority, setPriority] = useState<Priority>(restored?.priority ?? "none");
  const [tagIds, setTagIds] = useState<number[]>(restored?.tagIds ?? []);
  const [newTag, setNewTag] = useState(restored?.newTag ?? "");
  const [dateDraft, setDateDraft] = useState<DateDraft>(() => restored?.dateDraft ?? emptyDraft());
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
  // A restored draft restores these too, or a raw token still in its title
  // would override the List / Priority it had chosen.
  const [listChosen, setListChosen] = useState(restored?.listId != null);
  const [priorityChosen, setPriorityChosen] = useState(restored?.priorityChosen ?? false);
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
  // Title-first (#540): the field controls wait behind "Details". Collapsed,
  // they are unmounted rather than hidden — Modal's Tab trap matches hidden
  // focusables too — and every value lives in this component's state, so
  // collapsing never loses what was chosen.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();
  // Save feedback (#544). `busy` is the in-flight guard: a ref, because a
  // second click or Enter repeat lands in the same tick as the first, before
  // any state it set has re-rendered. `saving` is what the button shows.
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  // A submit whose title has no words left once tokens are parsed out: the
  // reason is shown beside the Title field, and the typed text stays put.
  const [titleInvalid, setTitleInvalid] = useState(false);
  const titleErrorId = useId();
  // How many saves have failed in this dialog; non-zero shows "Task not
  // saved" with Retry. The dialog closes on success, so it never resets.
  const [saveFailures, setSaveFailures] = useState(0);
  const draftNoteId = useId();

  // The draft as it stands: the title and the hand-made choices, never the
  // transient Assist state. Kept on every change, so Escape, the X, Cancel,
  // a backdrop click and a failed save all leave it behind alike.
  const draft = useMemo<QuickAddDraft>(
    () => ({
      title,
      listId: listChosen ? listId : null,
      priority,
      priorityChosen,
      tagIds,
      newTag,
      dateDraft,
    }),
    [title, listChosen, listId, priority, priorityChosen, tagIds, newTag, dateDraft],
  );
  useEffect(() => {
    if (userId !== null) saveQuickAddDraft(userId, draft);
  }, [userId, draft]);

  /** A title edit re-arms Assist: the next "Add task" parses the new text
   * rather than saving stale suggestions, keeping the behaviour "parse on
   * submit" exactly as in the bar. Any recurrence / reminder chips from the
   * previous parse go with it — they're Assist-only artifacts with no
   * control of their own, so a fresh parse must own them outright. */
  function onTitleChange(next: string): void {
    setTitle(next);
    setTitleInvalid(false);
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
      // The populated form is the confirmation beat. Details stays as the
      // User left it: every field Assist can fill has a summary chip, so the
      // review is on screen either way.
      return true;
    } finally {
      setParsing(false);
    }
  }

  /** Taking the List chip away steps back one level: a List picked over the
   * viewed one falls back to the viewed one, and the viewed List itself (or
   * a pick made from the Inbox) falls back to the Inbox — the destination a
   * bare title always has. */
  function removeListChip(): void {
    setListId(listId !== homeListId ? homeListId : inboxId);
    // Removing is a choice too: a raw `~list` left in the title no longer
    // claims the field, it stays literal text, as it would after the select.
    setListChosen(true);
  }

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    void attempt({ assist: true });
  }

  /** Retry repeats the failed save with the form exactly as it stands. It
   * skips Assist: the save already got past the parse once, so a retry must
   * not stop short of saving to offer a new suggestion. */
  function retry(): void {
    void attempt({ assist: false });
  }

  async function attempt({ assist }: { assist: boolean }): Promise<void> {
    if (busy.current) {
      return;
    }
    busy.current = true;
    try {
      await parseAndSave(assist);
    } finally {
      busy.current = false;
    }
  }

  async function parseAndSave(assist: boolean): Promise<void> {
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
      setTitleInvalid(true);
      return;
    }
    // First submit with Assist available: parse into the form and wait for
    // the confirmation click. A parse that applies nothing (or fails) falls
    // straight through to the save below, so Assist never costs a click.
    if (assist && assistAvailable && !assistApplied && (await runAssist(plan))) {
      return;
    }
    setSaving(true);
    try {
      await save(plan, trimmed);
    } catch {
      // Never pretend: the dialog stays open on the same input, says the
      // Task was not saved, and offers Retry beside that message. Each
      // failure remounts the alert so a repeat failure is announced again.
      setSaveFailures((count) => count + 1);
    } finally {
      setSaving(false);
    }
  }

  async function save(plan: ReturnType<typeof parseQuickAdd>, trimmed: string): Promise<void> {
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
    // Only this draft is spent: it became the Task. Cleared before closing,
    // so nothing writes it back.
    if (userId !== null) clearQuickAddDraft(userId);
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
  const destination = lists.find((list) => list.id === listId) ?? null;
  const dateLabel = draftLabel(dateDraft, now);

  return (
    <form className="quick-add-dialog" onSubmit={(event) => void submit(event)}>
      {/* Only this part scrolls (#542): a failed save's message and the
      action footer below it stay on screen however long Details gets. */}
      <div className="quick-add-body">
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
            invalid={titleInvalid}
            describedBy={
              [titleInvalid ? titleErrorId : null, restored !== null ? draftNoteId : null]
                .filter((id) => id !== null)
                .join(" ") || undefined
            }
            trailingContent={
              parsing ? (
                <span
                  className="quick-add-assist-busy"
                  aria-label="Assist is parsing"
                  role="status"
                >
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
        {restored !== null && (
          <p className="quick-add-draft-note" id={draftNoteId}>
            Draft restored
          </p>
        )}
        {titleInvalid && (
          <p className="quick-add-field-error" role="alert" id={titleErrorId}>
            Enter a title to add the Task
          </p>
        )}
        <div className="quick-add-summary" role="group" aria-label="Summary">
          {destination === null || destination.is_inbox ? (
            <span className="quick-add-destination">
              <Icon name="inbox" size={14} />
              {destination?.name ?? "Inbox"}
            </span>
          ) : (
            <RemovableChip
              kind="list"
              removeLabel={`Remove list (${destination.name})`}
              onRemove={removeListChip}
            >
              {destination.name}
            </RemovableChip>
          )}
          {priority !== "none" && (
            <RemovableChip
              kind="tag"
              removeLabel={`Remove priority (${PRIORITY_LABELS[priority]})`}
              onRemove={() => {
                setPriority("none");
                setPriorityChosen(true);
              }}
            >
              {PRIORITY_LABELS[priority]} priority
            </RemovableChip>
          )}
          {dateLabel !== null && (
            <RemovableChip
              kind="date"
              removeLabel={`Remove date (${dateLabel})`}
              onRemove={() => changeDate(emptyDraft())}
            >
              {dateLabel}
            </RemovableChip>
          )}
          {tags
            .filter((tag) => tagIds.includes(tag.id))
            .map((tag) => (
              <RemovableChip
                key={tag.id}
                kind="tag"
                removeLabel={`Remove tag (${tag.name})`}
                onRemove={() => toggleTag(tag.id)}
              >
                #{tag.name}
              </RemovableChip>
            ))}
          {newTag.trim() !== "" && (
            <RemovableChip
              kind="tag"
              removeLabel={`Remove tag (${newTag.trim()})`}
              onRemove={() => setNewTag("")}
            >
              #{newTag.trim()}
            </RemovableChip>
          )}
          {(recurrence !== null || reminders.length > 0) && (
            <div className="quick-add-assist-chips" role="group" aria-label="Assist suggestions">
              {recurrence !== null && (
                <RemovableChip
                  kind="date"
                  removeLabel="Remove recurrence"
                  onRemove={() => setRecurrence(null)}
                >
                  {formatRecurrenceRule(recurrence)}
                </RemovableChip>
              )}
              {reminders.map((offset) => (
                <RemovableChip
                  key={offset}
                  kind="date"
                  removeLabel={`Remove reminder (${formatReminderOffset(offset)})`}
                  onRemove={() => removeReminder(offset)}
                >
                  {formatReminderOffset(offset)}
                </RemovableChip>
              ))}
              {reminders.length > 0 && <ReminderDeliveryNote />}
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn-quiet quick-add-details-toggle"
          aria-expanded={detailsOpen}
          // Collapsed, the panel is unmounted: point at it only when it exists.
          aria-controls={detailsOpen ? detailsId : undefined}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          <Icon name={detailsOpen ? "chevron-up" : "chevron-down"} size={16} />
          Details
        </button>
        {detailsOpen && (
          <div className="quick-add-details" id={detailsId}>
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
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => pickDay(localDayOf(new Date()))}
                >
                  Today
                </button>
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => pickDay(addDays(localDayOf(new Date()), 1))}
                >
                  Tomorrow
                </button>
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => pickDay(nextMonday(localDayOf(new Date())))}
                >
                  Next Week
                </button>
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => changeDate(emptyDraft())}
                >
                  Clear date
                </button>
              </div>
              <DateFieldset draft={dateDraft} onChange={changeDate} />
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
          </div>
        )}
      </div>
      {saveFailures > 0 && (
        <div className="quick-add-save-error">
          <p key={saveFailures} role="alert">
            Task not saved
          </p>
          {/* aria-disabled while a save is in flight, like "Add task": the
          button keeps focus, and the busy ref ignores the extra press. */}
          <button
            className="btn-secondary"
            type="button"
            aria-disabled={saving || undefined}
            onClick={retry}
          >
            Retry
          </button>
        </div>
      )}
      <div className="quick-add-dialog-actions">
        {!isEmptyDraft(draft) && (
          <button
            className="btn-quiet quick-add-discard"
            type="button"
            onClick={() => {
              if (!busy.current) onDiscard(draft);
            }}
          >
            Discard draft
          </button>
        )}
        <button className="btn-quiet" type="button" onClick={onClose}>
          Cancel
        </button>
        {/* aria-disabled, not disabled: a disabled button drops focus to
        <body>, out of the dialog's Tab trap; the busy ref ignores it instead. */}
        <button className="btn-primary" type="submit" aria-disabled={saving || undefined}>
          {saving ? "Saving…" : "Add task"}
        </button>
      </div>
    </form>
  );
}
