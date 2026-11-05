import {
  ApiError,
  createCheckItem,
  createTask,
  fetchCalendarEvents,
  fetchHabits,
  fetchLists,
  fetchSearchTasks,
  fetchSmartTasks,
  fetchTags,
  fetchTask,
  putCheckIn,
  updateTask,
  type Priority,
  type Task,
  type TaskCreateInput,
  type TaskPatch,
} from "../api";
import { browserTimeZone, fromDayIso, instantOf, localDayOf, zonedDay } from "../dates";

/** A failed tool call, in transport-neutral terms. `authExpired` means the login lapsed. */
export class VoiceToolError extends Error {
  constructor(
    message: string,
    public readonly authExpired = false,
  ) {
    super(message);
  }
}

export const writableTaskIds = new Set<number>();
export const writableHabitIds = new Set<number>();
const EMPTY = { listId: null, tagId: null, priority: null } as const;
const brief = (task: Task) => ({
  id: task.id,
  title: task.title,
  completed: task.completed,
  priority: task.priority,
  start_date: task.start_date,
  due_date: task.due_date,
  is_all_day: task.is_all_day,
  list_id: task.list_id,
  recurrence: task.recurrence,
  tags: task.tags.map((tag) => tag.name),
});

export async function getAgenda(): Promise<object> {
  const today = localDayOf(new Date());
  const [taskPage, habitPage, events, lists, tags] = await Promise.all([
    fetchSmartTasks("today", today, EMPTY),
    fetchHabits(today),
    fetchCalendarEvents(today, today).catch(() => ({ events: [], failures: [] })),
    fetchLists(),
    fetchTags(),
  ]);
  taskPage.items.forEach((task) => writableTaskIds.add(task.id));
  habitPage.items.forEach((habit) => writableHabitIds.add(habit.id));
  return {
    today,
    window_end: today,
    time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    tasks: taskPage.items.map(brief),
    tasks_total: taskPage.total,
    habits_due_today: habitPage.items.map(({ id, name }) => ({ id, name })),
    events: events.events,
    lists: lists.items.map(({ id, name }) => ({ id, name })),
    tags: tags.items.map(({ id, name }) => ({ id, name })),
  };
}

// -- writes -------------------------------------------------------------
// Mirror of mcp/oci/src/tuk_mcp/tools.py (ADR 0014): same argument handling, due parsing, name
// resolution and id allowlist, so the two clients cannot drift on what a word means.
const PRIORITIES: Priority[] = ["none", "low", "medium", "high"];
const ACCEPTED_FORMS =
  "today, tomorrow, yesterday, a weekday name (e.g. monday), " +
  "or an ISO date (YYYY-MM-DD), optionally with a time (HH:MM)";
const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function badDate(word: string): Error {
  return new Error(`Could not understand date '${word}' — use ${ACCEPTED_FORMS}`);
}

function bareDay(head: string, today: string): string | null {
  const word = head.toLowerCase();
  const offset = { today: 0, tomorrow: 1, yesterday: -1 }[word];
  const shift = (days: number): string => {
    const date = fromDayIso(today);
    date.setDate(date.getDate() + days);
    return localDayOf(date);
  };
  if (offset !== undefined) return shift(offset);
  const weekday = WEEKDAYS[word];
  if (weekday !== undefined) return shift((weekday - fromDayIso(today).getDay() + 7) % 7 || 7);
  if (/^\d{4}-\d{2}-\d{2}$/.test(head) && localDayOf(fromDayIso(head)) === head) return head;
  return null;
}

/** A bare day word is an all-day instant (UTC midnight, the API's date-only convention); a word
 * with a time is that wall-clock time in the tab's own IANA zone. */
export function parseDate(word: string, today: string): string {
  const trimmed = word.trim();
  const space = trimmed.indexOf(" ");
  const head = space < 0 ? trimmed : trimmed.slice(0, space);
  const day = bareDay(head, today);
  if (day === null) throw badDate(word);
  if (space < 0) return `${day}T00:00:00Z`;
  const clock = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(trimmed.slice(space + 1).trim());
  if (!clock || Number(clock[1]) > 23 || Number(clock[2]) > 59) throw badDate(word);
  return instantOf(day, `${clock[1]}:${clock[2]}`);
}

function scheduleFields(
  args: Record<string, unknown>,
): TaskPatch & { time_zone: string; due_date: string; is_all_day: boolean } {
  if (args.due === undefined || args.due === null) throw new Error("due is required.");
  const today = localDayOf(new Date());
  return {
    time_zone: browserTimeZone(),
    ...(args.start === undefined || args.start === null
      ? {}
      : { start_date: parseDate(String(args.start), today) }),
    due_date: parseDate(String(args.due), today),
    // A bare day word is all-day; a word with a time is not.
    is_all_day: !String(args.due).trim().includes(" "),
  };
}

async function namedId(name: string, kind: "list" | "tag"): Promise<number> {
  const items = (await (kind === "list" ? fetchLists() : fetchTags())).items;
  const want = name.toLowerCase();
  const found = items.find((item) => item.name.toLowerCase() === want);
  if (found) return found.id;
  const known = items.map((item) => item.name).sort();
  throw new Error(
    `Unknown ${kind} '${name}' — available ${kind}s: ${known.length ? known.join(", ") : "(none)"}`,
  );
}

function writableTask(args: Record<string, unknown>): number {
  const id = args.task_id;
  if (typeof id !== "number" || !Number.isInteger(id))
    throw new Error("task_id must be an integer.");
  if (!writableTaskIds.has(id))
    throw new Error(
      `Task ${id} was not read in this session — call get_agenda, search_tasks or get_task ` +
        "first and use an id they return.",
    );
  return id;
}

async function loadTask(id: number): Promise<Task> {
  try {
    return await fetchTask(id);
  } catch (error) {
    throw error instanceof ApiError && error.code === "not_found"
      ? new Error(`Task ${id} not found.`)
      : error;
  }
}

async function patchTask(id: number, patch: TaskPatch): Promise<Task> {
  try {
    return await updateTask(id, patch);
  } catch (error) {
    throw error instanceof ApiError && error.code === "not_found"
      ? new Error(`Task ${id} not found.`)
      : error;
  }
}

/** The day a recurring Task now sits on, read the way the app shows it. */
const dueDayOf = (task: Task): string | null =>
  task.due_date === null
    ? null
    : task.is_all_day
      ? task.due_date.slice(0, 10)
      : zonedDay(task.due_date, task.time_zone);

async function createTaskRpc(args: Record<string, unknown>): Promise<object> {
  const { title } = args;
  if (typeof title !== "string" || !title.trim())
    throw new Error("title must be a non-empty string.");
  const body: TaskCreateInput = { title: title.trim() };
  if (args.description != null) body.description = String(args.description);
  if (args.priority != null) body.priority = args.priority as Priority;
  if (args.due != null) {
    const { time_zone, start_date, due_date, is_all_day } = scheduleFields(args);
    Object.assign(body, { time_zone, due_date, is_all_day });
    if (start_date != null) body.start_date = start_date;
  }
  if (args.list != null) body.list_id = await namedId(String(args.list), "list"); // else Inbox
  if (Array.isArray(args.tags) && args.tags.length)
    body.tag_ids = await Promise.all(args.tags.map((name) => namedId(String(name), "tag")));
  const task = await createTask(body);
  writableTaskIds.add(task.id);
  return brief(task);
}

async function scheduleRpc(args: Record<string, unknown>, reschedule: boolean): Promise<object> {
  const id = writableTask(args);
  const scheduled = (await loadTask(id)).due_date !== null;
  if (scheduled && !reschedule)
    throw new Error(`Task ${id} is already scheduled — use reschedule_task.`);
  if (!scheduled && reschedule) throw new Error(`Task ${id} is not scheduled — use schedule_task.`);
  return brief(await patchTask(id, scheduleFields(args)));
}

async function completeRpc(args: Record<string, unknown>): Promise<object> {
  const task = await patchTask(writableTask(args), { completed: true });
  // A recurring Task advances in place instead of closing (ADR 0003), so "done" would be a lie.
  const advanced = !task.completed && task.recurrence !== null;
  return {
    ...brief(task),
    advanced_to_next_occurrence: advanced,
    result: advanced ? `advanced to ${dueDayOf(task) ?? "its next occurrence"}` : "completed",
  };
}

async function addTagsRpc(args: Record<string, unknown>): Promise<object> {
  const id = writableTask(args);
  const names = args.tags;
  if (!Array.isArray(names) || !names.length)
    throw new Error("tags must be a non-empty list of existing Tag names.");
  const wanted = await Promise.all(names.map((name) => namedId(String(name), "tag")));
  // The patch endpoint replaces the whole set, so union with what the Task already has.
  const have = (await loadTask(id)).tags.map((tag) => tag.id);
  const merged = [...have, ...[...new Set(wanted)].filter((tagId) => !have.includes(tagId))];
  return brief(await patchTask(id, { tag_ids: merged }));
}

async function addCheckItemsRpc(
  args: Record<string, unknown>,
  refresh?: () => void,
): Promise<object> {
  const id = writableTask(args);
  const { titles } = args;
  if (!Array.isArray(titles) || !titles.length || !titles.every((t) => typeof t === "string"))
    throw new Error("titles must be a non-empty list of strings.");
  let task: Task | undefined;
  for (const [index, title] of (titles as string[]).entries()) {
    try {
      task = await createCheckItem(id, title);
    } catch (error) {
      if (index > 0) {
        refresh?.();
        const detail = `Landed: ${titles.slice(0, index).join(", ")}. Failed or not attempted: ${titles.slice(index).join(", ")}. ${error instanceof Error ? error.message : "Voice tool failed"}`;
        if (error instanceof ApiError && error.status === 401)
          throw new VoiceToolError(detail, true);
        throw new Error(detail);
      }
      throw error instanceof ApiError && error.code === "not_found"
        ? new Error(`Task ${id} not found.`)
        : error;
    }
  }
  return { ...brief(task as Task), check_items: (task as Task).check_items };
}

async function checkInRpc(args: Record<string, unknown>): Promise<object> {
  const id = args.habit_id;
  if (typeof id !== "number" || !writableHabitIds.has(id))
    throw new Error(
      `Habit ${String(id)} was not read in this session — call get_agenda first ` +
        "and use a habit id it returns.",
    );
  const day = args.day ? String(args.day) : localDayOf(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || localDayOf(fromDayIso(day)) !== day)
    throw new Error("day must be an ISO date YYYY-MM-DD.");
  const value = args.value === undefined || args.value === null ? 1 : Number(args.value);
  if (!Number.isFinite(value)) throw new Error("value must be a number.");
  return putCheckIn(id, day, value); // PUT keys on (habit, day): repeating it is harmless
}

/** Transport-neutral voice tools: every roster `voice` method (reads and writes — the name
 * predates T7), run with JSON-shaped arguments and results. Starts a fresh allowlist for this
 * session. `refresh` runs after each applied write so the visible views show it like an in-app
 * write. Failures surface as `VoiceToolError`. */
export function createVoiceTools(refresh?: () => void) {
  writableTaskIds.clear();
  writableHabitIds.clear();
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    get_agenda: () => getAgenda(),
    search_tasks: async ({ query, limit = 20 }) => {
      if (typeof query !== "string" || !query.trim())
        throw new Error("query must be a non-empty string.");
      const page = await fetchSearchTasks(query.trim(), { ...EMPTY, completed: false });
      const rows = page.items.slice(0, Number(limit));
      rows.forEach((task) => writableTaskIds.add(task.id));
      return { tasks: rows.map(brief), total: page.total };
    },
    get_task: async ({ task_id }) => {
      if (!Number.isInteger(task_id)) throw new Error("task_id must be an integer.");
      const task = await fetchTask(Number(task_id));
      writableTaskIds.add(task.id);
      return task;
    },
    create_task: createTaskRpc,
    schedule_task: (args) => scheduleRpc(args, false),
    reschedule_task: (args) => scheduleRpc(args, true),
    complete_task: completeRpc,
    set_priority: async (args) => {
      const id = writableTask(args);
      if (!PRIORITIES.includes(args.priority as Priority))
        throw new Error(`priority must be one of: ${PRIORITIES.join(", ")}.`);
      return brief(await patchTask(id, { priority: args.priority as Priority }));
    },
    set_list: async (args) => {
      const id = writableTask(args);
      return brief(
        await patchTask(id, { list_id: await namedId(String(args.list ?? ""), "list") }),
      );
    },
    add_tags: addTagsRpc,
    add_check_items: (args) => addCheckItemsRpc(args, refresh),
    check_in_habit: checkInRpc,
  };
  const writes = new Set([
    "create_task",
    "schedule_task",
    "reschedule_task",
    "complete_task",
    "set_priority",
    "set_list",
    "add_tags",
    "add_check_items",
    "check_in_habit",
  ]);
  return {
    methods: Object.keys(handlers),
    async execute(name: string, args: Record<string, unknown>): Promise<unknown> {
      try {
        const result = await handlers[name]!(args);
        if (writes.has(name)) refresh?.();
        return result;
      } catch (error) {
        if (error instanceof VoiceToolError) throw error;
        throw new VoiceToolError(
          error instanceof Error ? error.message : "Voice tool failed",
          error instanceof ApiError && error.status === 401,
        );
      }
    },
  };
}
