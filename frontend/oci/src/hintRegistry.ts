/** Domain-vocabulary copy registry for `Hint` (#261), keyed by the same
 * terms `CONTEXT.md` defines — so a term explained twice can't be explained
 * two different ways. Copy is derived from `CONTEXT.md` and the ADRs
 * referenced below and kept to one or two sentences: what the thing is,
 * and what the user's next action would do. An entry that contradicts
 * `CONTEXT.md` is a bug in the entry, not in the glossary. */
export const HINT_REGISTRY = {
  "key-result":
    "A measurable number belonging to a Goal. Attaching this Task counts it toward the Key Result's progress.",
  score:
    "A Goal's overall progress: the mean of its Key Results' ratios. Blank means unmeasured, not failed.",
  "focused-goal":
    "Makes this the one Goal shown on Stand-up. Setting it unfocuses whichever Goal was focused before.",
  abandon:
    "Keeps the Goal in your history, marked as dropped, with its Score frozen. Delete removes it entirely.",
  "list-archive": "Hides the List from the sidebar but keeps its Tasks. Delete removes both.",
  "smart-list-today": "Tasks due today, or overdue.",
  "smart-list-next7": "Tasks due within the next 7 days.",
  "smart-list-all": "Every open Task across every List.",
  inbox: "The built-in List that receives Tasks not filed anywhere else.",
  "check-item":
    "A line in this Task's checklist. It has its own done state but isn't a Task itself.",
  "list-vs-tag": "A Task lives in exactly one List, but can carry any number of Tags.",
  streak: "The count of consecutive scheduled days this Habit has been checked in without a miss.",
  target: "The amount a Numeric Habit's Check-ins count toward in one day.",
  pomo: "A fixed-length countdown focus block, default 25 minutes.",
  "break-minutes":
    "How long you rest between Pomos. A long break replaces a short one every few rounds.",
  assist:
    "Runs locally and only ever suggests — nothing is written until you confirm it, and it's never required.",
  "group-by": "Groups rows under headings — same rows, arranged into clusters.",
  "sort-by":
    "Orders rows within their group — doesn't change what's grouped, only what comes first.",
  "settings-feature-toggle":
    "Hides this destination from navigation. The data underneath is kept, not deleted.",
  "calendar-today": "Jumps the view back to today's date.",
  "calendar-refresh":
    "Refetches Events from your connected Google Calendar. Google Calendar is read only, so this pulls in changes but never pushes any out.",
  "unscheduled-chips": "Drag a chip onto the calendar to schedule that Task.",
} as const satisfies Record<string, string>;

export type HintKey = keyof typeof HINT_REGISTRY;
