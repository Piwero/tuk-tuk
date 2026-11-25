import type { Priority } from "./api";
import type { DateDraft } from "./dates";
import { PRIORITY_LABELS } from "./grouping";

/** An unsent Quick-Add capture (#541): the title and the choices the User
 * made by hand. Transient Assist state (recurrence / reminder chips, the
 * "already parsed" flag) is deliberately not part of it — a restored draft
 * parses afresh on its next "Add task". */
export interface QuickAddDraft {
  title: string;
  /** The List the User picked, or null when they left the destination to
   * the context the dialog opens with. */
  listId: number | null;
  priority: Priority;
  /** Whether `priority` was set by hand, so a raw `!token` still in a
   * restored title doesn't override it. */
  priorityChosen: boolean;
  tagIds: number[];
  newTag: string;
  dateDraft: DateDraft;
}

const KEY_PREFIX = "tuktuk.quickAddDraft.";

function keyFor(userId: number): string {
  return `${KEY_PREFIX}${userId}`;
}

/** True when the draft holds nothing worth keeping. A List on its own
 * doesn't count: it is where a Task would go, not a Task being written. */
export function isEmptyDraft(draft: QuickAddDraft): boolean {
  const { dateDraft } = draft;
  return (
    draft.title.trim() === "" &&
    draft.priority === "none" &&
    draft.tagIds.length === 0 &&
    draft.newTag.trim() === "" &&
    dateDraft.dueDay === "" &&
    dateDraft.startDay === "" &&
    dateDraft.dueTime === "" &&
    dateDraft.startTime === ""
  );
}

function isDraft(value: unknown): value is QuickAddDraft {
  if (typeof value !== "object" || value === null) return false;
  const draft = value as Record<string, unknown>;
  const date = draft.dateDraft as Record<string, unknown> | null | undefined;
  return (
    typeof draft.title === "string" &&
    (draft.listId === null || typeof draft.listId === "number") &&
    typeof draft.priority === "string" &&
    Object.keys(PRIORITY_LABELS).includes(draft.priority) &&
    typeof draft.priorityChosen === "boolean" &&
    Array.isArray(draft.tagIds) &&
    draft.tagIds.every((id) => typeof id === "number") &&
    typeof draft.newTag === "string" &&
    typeof date === "object" &&
    date !== null &&
    typeof date.allDay === "boolean" &&
    ["startDay", "dueDay", "startTime", "dueTime"].every((field) => typeof date[field] === "string")
  );
}

/** Drops every draft stored for a User other than `userId` in this tab —
 * one whose session ended without a log out (a 401 clears no storage), say.
 * Called as soon as the signed-in User is known, so another User's unsent
 * text never sits in storage waiting for someone to open Quick-Add. */
export function forgetOtherUsersDrafts(userId: number): void {
  try {
    const own = keyFor(userId);
    const keys = Array.from({ length: sessionStorage.length }, (_, index) =>
      sessionStorage.key(index),
    );
    for (const key of keys) {
      if (key?.startsWith(KEY_PREFIX) && key !== own) sessionStorage.removeItem(key);
    }
  } catch {
    // Storage unavailable: then there is nothing in it to forget either.
  }
}

/** The User's own unsent draft, or null. Other Users' drafts are dropped on
 * the way too, so one can never be shown to whoever signed in next. */
export function loadQuickAddDraft(userId: number): QuickAddDraft | null {
  forgetOtherUsersDrafts(userId);
  try {
    const raw = sessionStorage.getItem(keyFor(userId));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isDraft(parsed) && !isEmptyDraft(parsed) ? parsed : null;
  } catch {
    // Unavailable storage or a corrupt entry: start from an empty form.
    return null;
  }
}

/** Keeps the draft for this User, or forgets it once there's nothing in it.
 * A storage failure is swallowed: capture never depends on the draft. */
export function saveQuickAddDraft(userId: number, draft: QuickAddDraft): void {
  try {
    if (isEmptyDraft(draft)) {
      sessionStorage.removeItem(keyFor(userId));
    } else {
      sessionStorage.setItem(keyFor(userId), JSON.stringify(draft));
    }
  } catch {
    // Storage full or unavailable: the dialog still works, the draft just
    // won't survive closing it.
  }
}

/** Forgets this User's draft — after it was saved as a Task, or discarded. */
export function clearQuickAddDraft(userId: number): void {
  try {
    sessionStorage.removeItem(keyFor(userId));
  } catch {
    // Storage unavailable: then nothing was kept in it either.
  }
}
