import { vi } from "vitest";

import { type HabitType, type Priority, type ViewMode } from "../api";
import { taskDayWindow } from "../calendar";
import { addDays } from "../dates";
import { habitDueOn } from "../habitFrequency";
import { byName, SORT_GAP } from "../ordering";
import { decrementCount, nextOccurrenceISO } from "./fakeRecurrence";

export interface FakeList {
  id: number;
  name: string;
  is_inbox: boolean;
  color: string | null;
  emoji: string | null;
  is_archived: boolean;
  folder_id: number | null;
  sort_order: number;
  view_mode: ViewMode;
}

export interface FakeFolder {
  id: number;
  name: string;
  sort_order: number;
}

export interface FakeSection {
  id: number;
  list_id: number;
  name: string;
  sort_order: number;
}

export interface FakeTag {
  id: number;
  name: string;
  color: string | null;
}

export interface FakeCheckItem {
  id: number;
  title: string;
  done: boolean;
  sort_order: number;
}

export interface FakeTask {
  id: number;
  title: string;
  completed: boolean;
  completed_at: string | null;
  description: string;
  priority: Priority;
  list_id: number;
  section_id: number | null;
  sort_order: number;
  start_date: string | null;
  due_date: string | null;
  is_all_day: boolean;
  time_zone: string | null;
  reminders: string[];
  recurrence: string | null;
  check_items: FakeCheckItem[];
  tags: FakeTag[];
  created_at: string;
}

export interface RecordedRequest {
  method: string;
  url: string;
  body?: unknown;
}

export interface FakeCompletedOccurrence {
  id: number;
  task_id: number;
  title: string;
  list_id: number;
  completed_at: string;
  due_date: string;
  is_all_day: boolean;
}

export interface FakeHabit {
  id: number;
  name: string;
  type: HabitType;
  goal: number;
  step: number;
  unit: string | null;
  icon: string | null;
  color: string | null;
  encouragement: string;
  frequency: string;
  created_at: string;
}

export interface FakeCheckIn {
  id: number;
  habit_id: number;
  date: string;
  value: number;
}

interface FakeApiState {
  lists: FakeList[];
  folders: FakeFolder[];
  sections: FakeSection[];
  tags: FakeTag[];
  tasks: FakeTask[];
  completedOccurrences: FakeCompletedOccurrence[];
  habits: FakeHabit[];
  checkIns: FakeCheckIn[];
  requests: RecordedRequest[];
}

export const INBOX: FakeList = {
  id: 1,
  name: "Inbox",
  is_inbox: true,
  color: null,
  emoji: null,
  is_archived: false,
  folder_id: null,
  sort_order: 0,
  view_mode: "list",
};

let nextTaskId = 100;
let nextListId = 10;
let nextFolderId = 500;
let nextCheckItemId = 900;
let nextTagId = 700;
let nextSectionId = 800;
let nextOccurrenceId = 950;
let nextHabitId = 300;
let nextCheckInId = 9000;

export function fakeTask(title: string, overrides: Partial<FakeTask> = {}): FakeTask {
  const id = nextTaskId++;
  return {
    id,
    title,
    completed: false,
    completed_at: null,
    description: "",
    priority: "none",
    list_id: INBOX.id,
    section_id: null,
    sort_order: id * SORT_GAP,
    start_date: null,
    due_date: null,
    is_all_day: false,
    time_zone: null,
    reminders: [],
    recurrence: null,
    check_items: [],
    tags: [],
    created_at: "2026-07-03T10:00:00Z",
    ...overrides,
  };
}

export function fakeSection(
  name: string,
  listId: number,
  overrides: Partial<FakeSection> = {},
): FakeSection {
  const id = nextSectionId++;
  return { id, list_id: listId, name, sort_order: id * SORT_GAP, ...overrides };
}

export function fakeTag(name: string, overrides: Partial<FakeTag> = {}): FakeTag {
  return { id: nextTagId++, name, color: null, ...overrides };
}

export function fakeCheckItem(
  title: string,
  overrides: Partial<FakeCheckItem> = {},
): FakeCheckItem {
  const id = nextCheckItemId++;
  return { id, title, done: false, sort_order: id * SORT_GAP, ...overrides };
}

export function fakeList(name: string, overrides: Partial<FakeList> = {}): FakeList {
  const id = nextListId++;
  return {
    id,
    name,
    is_inbox: false,
    color: null,
    emoji: null,
    is_archived: false,
    folder_id: null,
    sort_order: id * SORT_GAP,
    view_mode: "list",
    ...overrides,
  };
}

export function fakeFolder(name: string, overrides: Partial<FakeFolder> = {}): FakeFolder {
  const id = nextFolderId++;
  return { id, name, sort_order: id * SORT_GAP, ...overrides };
}

export function fakeHabit(name: string, overrides: Partial<FakeHabit> = {}): FakeHabit {
  return {
    id: nextHabitId++,
    name,
    type: "boolean",
    goal: 1,
    step: 1,
    unit: null,
    icon: null,
    color: null,
    encouragement: "",
    frequency: "FREQ=DAILY",
    created_at: "2026-07-03T10:00:00Z",
    ...overrides,
  };
}

const nextOrder = (rows: { sort_order: number }[]): number =>
  Math.max(0, ...rows.map((row) => row.sort_order)) + SORT_GAP;

/** Fakes the HTTP API at the fetch boundary and records every request. */
export function installFakeApi({
  lists = [INBOX],
  folders = [],
  sections = [],
  tags = [],
  tasks = [],
  completedOccurrences = [],
  habits = [],
  checkIns = [],
}: {
  lists?: FakeList[];
  folders?: FakeFolder[];
  sections?: FakeSection[];
  tags?: FakeTag[];
  tasks?: FakeTask[];
  completedOccurrences?: FakeCompletedOccurrence[];
  habits?: FakeHabit[];
  checkIns?: FakeCheckIn[];
} = {}): FakeApiState {
  const state: FakeApiState = {
    lists: lists.map((list) => ({ ...list })),
    folders: folders.map((folder) => ({ ...folder })),
    sections: sections.map((section) => ({ ...section })),
    tags: tags.map((tag) => ({ ...tag })),
    tasks: tasks.map((task) => ({
      ...task,
      check_items: [...task.check_items],
      tags: task.tags.map((tag) => ({ ...tag })),
    })),
    completedOccurrences: completedOccurrences.map((occurrence) => ({ ...occurrence })),
    habits: habits.map((habit) => ({ ...habit })),
    checkIns: checkIns.map((checkIn) => ({ ...checkIn })),
    requests: [],
  };

  const json = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  const page = (items: unknown[]): unknown => ({
    items,
    total: items.length,
    limit: 50,
    offset: 0,
  });

  const notFound = (message: string): Response =>
    json({ error: { code: "not_found", message } }, 404);

  /** Mirrors the backend's resolve_section rule: 404 unknown, 409 foreign. */
  const sectionMismatch = (sectionId: number, listId: number): Response | null => {
    const section = state.sections.find((s) => s.id === sectionId);
    if (!section) {
      return notFound(`Section ${sectionId} not found`);
    }
    if (section.list_id !== listId) {
      return json(
        {
          error: {
            code: "section_list_mismatch",
            message: `Section ${section.id} belongs to another list`,
          },
        },
        409,
      );
    }
    return null;
  };

  /** Mirror of the backend's day-window rule: days are read in each task's
   * own timezone (taskDayWindow implements exactly that reading). */
  const dayWindow = (task: FakeTask): [string, string] | null => taskDayWindow(task);

  const inSmartView = (task: FakeTask, view: string, today: string): boolean => {
    const window = dayWindow(task);
    if (window === null) {
      return false;
    }
    const [first, last] = window;
    if (view === "today") {
      return first <= today;
    }
    return first <= addDays(today, 6) && last >= today;
  };

  /** Mirror of the backend's completion rule: a recurring task advances in
   * place (occurrence recorded, dates shifted, checklist reset) and only
   * completes for real when its recurrence has ended. */
  const completeTask = (task: FakeTask): void => {
    if (task.recurrence !== null && task.due_date !== null) {
      const next = nextOccurrenceISO(task.recurrence, task.due_date, task.is_all_day);
      if (next !== null) {
        state.completedOccurrences.push({
          id: nextOccurrenceId++,
          task_id: task.id,
          title: task.title,
          list_id: task.list_id,
          completed_at: new Date().toISOString(),
          due_date: task.due_date,
          is_all_day: task.is_all_day,
        });
        const delta = new Date(next).getTime() - new Date(task.due_date).getTime();
        if (task.start_date !== null) {
          const shifted = new Date(new Date(task.start_date).getTime() + delta);
          task.start_date = `${shifted.toISOString().slice(0, 19)}Z`;
        }
        task.due_date = next;
        task.recurrence = decrementCount(task.recurrence);
        for (const item of task.check_items) {
          item.done = false;
        }
        return;
      }
    }
    task.completed = true;
    task.completed_at = new Date().toISOString();
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    state.requests.push({ method, url: url.pathname + url.search, body });

    if (method === "GET" && url.pathname === "/api/v1/lists") {
      const items = [...state.lists].sort(
        (a, b) =>
          Number(b.is_inbox) - Number(a.is_inbox) || a.sort_order - b.sort_order || a.id - b.id,
      );
      return json(page(items));
    }
    if (method === "POST" && url.pathname === "/api/v1/lists") {
      const input = body as { name: string; color?: string | null; emoji?: string | null };
      const created = fakeList(input.name, {
        color: input.color ?? null,
        emoji: input.emoji ?? null,
        sort_order: nextOrder(state.lists),
      });
      state.lists.push(created);
      return json(created, 201);
    }
    const listMatch = url.pathname.match(/^\/api\/v1\/lists\/(\d+)$/);
    if (listMatch) {
      const listId = Number(listMatch[1]);
      const list = state.lists.find((l) => l.id === listId);
      if (!list) {
        return notFound(`List ${listId} not found`);
      }
      if (method === "PATCH") {
        Object.assign(list, body);
        return json(list);
      }
      if (method === "DELETE") {
        state.lists = state.lists.filter((l) => l.id !== listId);
        state.tasks = state.tasks.filter((t) => t.list_id !== listId);
        state.completedOccurrences = state.completedOccurrences.filter(
          (occurrence) => occurrence.list_id !== listId,
        );
        return new Response(null, { status: 204 });
      }
    }
    if (method === "GET" && url.pathname === "/api/v1/folders") {
      const items = [...state.folders].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
      return json(page(items));
    }
    if (method === "POST" && url.pathname === "/api/v1/folders") {
      const created = fakeFolder((body as { name: string }).name, {
        sort_order: nextOrder(state.folders),
      });
      state.folders.push(created);
      return json(created, 201);
    }
    const folderMatch = url.pathname.match(/^\/api\/v1\/folders\/(\d+)$/);
    if (folderMatch) {
      const folderId = Number(folderMatch[1]);
      const folder = state.folders.find((f) => f.id === folderId);
      if (!folder) {
        return notFound(`Folder ${folderId} not found`);
      }
      if (method === "PATCH") {
        Object.assign(folder, body);
        return json(folder);
      }
      if (method === "DELETE") {
        for (const list of state.lists) {
          if (list.folder_id === folderId) {
            list.folder_id = null;
          }
        }
        state.folders = state.folders.filter((f) => f.id !== folderId);
        return new Response(null, { status: 204 });
      }
    }
    if (method === "GET" && url.pathname === "/api/v1/tasks") {
      const listId = url.searchParams.get("list_id");
      const tagId = url.searchParams.get("tag_id");
      const view = url.searchParams.get("view");
      const today = url.searchParams.get("today");
      const rangeStart = url.searchParams.get("range_start");
      const rangeEnd = url.searchParams.get("range_end");
      const scheduled = url.searchParams.get("scheduled");
      const search = url.searchParams.get("search");
      const priority = url.searchParams.get("priority");
      // Smart Lists are computed over open tasks only (mirrors the backend).
      const completed = view !== null ? "false" : url.searchParams.get("completed");
      let items = state.tasks.filter(
        (task) =>
          (listId === null || task.list_id === Number(listId)) &&
          (tagId === null || task.tags.some((tag) => tag.id === Number(tagId))) &&
          (completed === null || task.completed === (completed === "true")) &&
          (priority === null || task.priority === priority),
      );
      if (scheduled !== null && (view !== null || rangeStart !== null)) {
        return json(
          {
            error: {
              code: "validation_error",
              message: "the scheduled filter is exclusive with view and range filters",
            },
          },
          422,
        );
      }
      if (search !== null && (view !== null || rangeStart !== null || scheduled !== null)) {
        return json(
          {
            error: {
              code: "validation_error",
              message: "search is exclusive with view, range and scheduled filters",
            },
          },
          422,
        );
      }
      if (search !== null) {
        // Mirrors the backend: empty queries match nothing, others match
        // titles, descriptions and Check Item titles case-insensitively.
        const query = search.trim().toLowerCase();
        items =
          query === ""
            ? []
            : items.filter((task) =>
                [task.title, task.description, ...task.check_items.map((item) => item.title)].some(
                  (text) => text.toLowerCase().includes(query),
                ),
              );
      }
      if (scheduled !== null) {
        items = items.filter((task) => (task.due_date !== null) === (scheduled === "true"));
      }
      if (view === "today" || view === "next7") {
        if (today === null) {
          return json({ error: { code: "validation_error", message: "today is required" } }, 422);
        }
        items = items.filter((task) => inSmartView(task, view, today));
      }
      if ((rangeStart === null) !== (rangeEnd === null)) {
        return json(
          {
            error: { code: "validation_error", message: "range_start and range_end come together" },
          },
          422,
        );
      }
      if (rangeStart !== null && rangeEnd !== null) {
        if (rangeStart > rangeEnd) {
          return json(
            {
              error: {
                code: "validation_error",
                message: "range_start must not be after range_end",
              },
            },
            422,
          );
        }
        // Mirror the backend's calendar window: inclusive day intersection.
        items = items.filter((task) => {
          const window = dayWindow(task);
          return window !== null && window[0] <= rangeEnd && window[1] >= rangeStart;
        });
      }
      items =
        completed === "true"
          ? [...items].sort(
              (a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? "") || b.id - a.id,
            )
          : [...items].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
      return json(page(items));
    }
    if (method === "POST" && url.pathname === "/api/v1/tasks") {
      const input = body as {
        title: string;
        list_id?: number;
        section_id?: number;
        priority?: Priority;
        tag_ids?: number[];
        start_date?: string;
        due_date?: string;
        is_all_day?: boolean;
        time_zone?: string;
      };
      const listId = input.list_id ?? INBOX.id;
      if (input.section_id !== undefined) {
        const rejection = sectionMismatch(input.section_id, listId);
        if (rejection) {
          return rejection;
        }
      }
      const tagIds = input.tag_ids ?? [];
      const missing = tagIds.find((id) => !state.tags.some((tag) => tag.id === id));
      if (missing !== undefined) {
        return notFound(`Tag ${missing} not found`);
      }
      const created = fakeTask(input.title, {
        list_id: listId,
        section_id: input.section_id ?? null,
        priority: input.priority ?? "none",
        start_date: input.start_date ?? null,
        due_date: input.due_date ?? null,
        is_all_day: input.is_all_day ?? false,
        time_zone: input.time_zone ?? null,
        tags: state.tags
          .filter((tag) => tagIds.includes(tag.id))
          .sort(byName)
          .map((tag) => ({ ...tag })),
        sort_order: nextOrder(state.tasks.filter((t) => t.list_id === listId)),
      });
      state.tasks.push(created);
      return json(created, 201);
    }
    if (method === "GET" && url.pathname === "/api/v1/completed-occurrences") {
      const listId = url.searchParams.get("list_id");
      const items = state.completedOccurrences
        .filter((occurrence) => listId === null || occurrence.list_id === Number(listId))
        .sort((a, b) => b.completed_at.localeCompare(a.completed_at) || b.id - a.id);
      return json(page(items));
    }
    if (method === "GET" && url.pathname === "/api/v1/sections") {
      const listId = url.searchParams.get("list_id");
      const items = state.sections
        .filter((section) => listId === null || section.list_id === Number(listId))
        .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
      return json(page(items));
    }
    if (method === "POST" && url.pathname === "/api/v1/sections") {
      const input = body as { list_id: number; name: string };
      const siblings = state.sections.filter((s) => s.list_id === input.list_id);
      const created = fakeSection(input.name, input.list_id, {
        sort_order: nextOrder(siblings),
      });
      state.sections.push(created);
      return json(created, 201);
    }
    const sectionMatch = url.pathname.match(/^\/api\/v1\/sections\/(\d+)$/);
    if (sectionMatch) {
      const sectionId = Number(sectionMatch[1]);
      const section = state.sections.find((s) => s.id === sectionId);
      if (!section) {
        return notFound(`Section ${sectionId} not found`);
      }
      if (method === "PATCH") {
        Object.assign(section, body);
        return json(section);
      }
      if (method === "DELETE") {
        state.sections = state.sections.filter((s) => s.id !== sectionId);
        for (const task of state.tasks) {
          if (task.section_id === sectionId) {
            task.section_id = null;
          }
        }
        return new Response(null, { status: 204 });
      }
    }
    if (method === "GET" && url.pathname === "/api/v1/tags") {
      const items = [...state.tags].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
      return json(page(items));
    }
    if (method === "POST" && url.pathname === "/api/v1/tags") {
      const input = body as { name: string; color?: string | null };
      if (state.tags.some((tag) => tag.name === input.name)) {
        return json(
          { error: { code: "tag_exists", message: `A tag named "${input.name}" already exists` } },
          409,
        );
      }
      const created = fakeTag(input.name, { color: input.color ?? null });
      state.tags.push(created);
      return json(created, 201);
    }
    const tagMatch = url.pathname.match(/^\/api\/v1\/tags\/(\d+)$/);
    if (tagMatch) {
      const tagId = Number(tagMatch[1]);
      const tag = state.tags.find((t) => t.id === tagId);
      if (!tag) {
        return notFound(`Tag ${tagId} not found`);
      }
      if (method === "PATCH") {
        const rename = (body as { name?: string }).name;
        if (rename !== undefined && state.tags.some((t) => t.id !== tagId && t.name === rename)) {
          return json(
            { error: { code: "tag_exists", message: `A tag named "${rename}" already exists` } },
            409,
          );
        }
        Object.assign(tag, body);
        // Mirror the backend: tasks reference the tag row, never a copy.
        for (const task of state.tasks) {
          task.tags = task.tags.map((t) => (t.id === tagId ? { ...tag } : t));
        }
        return json(tag);
      }
      if (method === "DELETE") {
        state.tags = state.tags.filter((t) => t.id !== tagId);
        for (const task of state.tasks) {
          task.tags = task.tags.filter((t) => t.id !== tagId);
        }
        return new Response(null, { status: 204 });
      }
    }
    const checkItemMatch = url.pathname.match(/^\/api\/v1\/tasks\/(\d+)\/check-items(?:\/(\d+))?$/);
    if (checkItemMatch) {
      const taskId = Number(checkItemMatch[1]);
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task) {
        return notFound(`Task ${taskId} not found`);
      }
      if (method === "POST" && checkItemMatch[2] === undefined) {
        const created = fakeCheckItem((body as { title: string }).title, {
          sort_order: nextOrder(task.check_items),
        });
        task.check_items.push(created);
        return json(task, 201);
      }
      const itemId = Number(checkItemMatch[2]);
      const item = task.check_items.find((i) => i.id === itemId);
      if (!item) {
        return notFound(`Check item ${itemId} not found on task ${taskId}`);
      }
      if (method === "PATCH") {
        Object.assign(item, body);
        // Mirror the backend rule: ticking the last open item completes the
        // parent — which advances a recurring parent in place instead.
        if ((body as { done?: boolean }).done === true && task.check_items.every((i) => i.done)) {
          completeTask(task);
        }
        task.check_items.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
        return json(task);
      }
      if (method === "DELETE") {
        task.check_items = task.check_items.filter((i) => i.id !== itemId);
        return new Response(null, { status: 204 });
      }
    }
    const taskMatch = url.pathname.match(/^\/api\/v1\/tasks\/(\d+)$/);
    if (taskMatch) {
      const taskId = Number(taskMatch[1]);
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task) {
        return notFound(`Task ${taskId} not found`);
      }
      if (method === "PATCH") {
        const { tag_ids, completed, ...rest } = body as {
          tag_ids?: number[];
          completed?: boolean;
        } & Record<string, unknown>;
        // Mirror the backend's reminder rules: no dateless Reminders, set
        // semantics, and clearing the date sweeps the Reminders with it.
        const effectiveDue = rest.due_date !== undefined ? rest.due_date : task.due_date;
        if (Array.isArray(rest.reminders)) {
          if (rest.reminders.length > 0 && effectiveDue === null) {
            return json(
              {
                error: {
                  code: "invalid_reminders",
                  message: "A task without a date cannot hold Reminders",
                },
              },
              422,
            );
          }
          rest.reminders = [...new Set(rest.reminders as string[])];
        } else if (effectiveDue === null && task.reminders.length > 0) {
          rest.reminders = [];
        }
        // Mirror the backend's recurrence rules: a dateless task cannot recur,
        // and clearing the date sweeps the recurrence with it.
        if (typeof rest.recurrence === "string" && effectiveDue === null) {
          return json(
            {
              error: {
                code: "invalid_recurrence",
                message: "A task without a date cannot recur",
              },
            },
            422,
          );
        }
        if (!("recurrence" in rest) && effectiveDue === null && task.recurrence !== null) {
          rest.recurrence = null;
        }
        if (
          typeof rest.list_id === "number" &&
          rest.list_id !== task.list_id &&
          rest.section_id === undefined
        ) {
          rest.section_id = null;
        }
        if (typeof rest.section_id === "number") {
          const targetList = typeof rest.list_id === "number" ? rest.list_id : task.list_id;
          const rejection = sectionMismatch(rest.section_id, targetList);
          if (rejection) {
            return rejection;
          }
        }
        Object.assign(task, rest);
        if (tag_ids !== undefined) {
          const missing = tag_ids.find((id) => !state.tags.some((tag) => tag.id === id));
          if (missing !== undefined) {
            return notFound(`Tag ${missing} not found`);
          }
          task.tags = state.tags
            .filter((tag) => tag_ids.includes(tag.id))
            .sort(byName)
            .map((tag) => ({ ...tag }));
        }
        // Completion last, against the task the patch produced (mirrors the
        // backend): completing a recurring task advances it in place.
        if (typeof completed === "boolean" && completed !== task.completed) {
          if (completed) {
            completeTask(task);
          } else {
            task.completed = false;
            task.completed_at = null;
          }
        }
        return json(task);
      }
      if (method === "DELETE") {
        state.tasks = state.tasks.filter((t) => t.id !== taskId);
        state.completedOccurrences = state.completedOccurrences.filter(
          (occurrence) => occurrence.task_id !== taskId,
        );
        return new Response(null, { status: 204 });
      }
    }
    if (method === "GET" && url.pathname === "/api/v1/habits") {
      const due = url.searchParams.get("due");
      // Mirror the backend's due filter: daily and N-times-per-week habits
      // are due every day; weekday habits only on their days.
      const items = state.habits.filter(
        (habit) => due === null || habitDueOn(habit.frequency, due),
      );
      return json(page(items));
    }
    if (method === "POST" && url.pathname === "/api/v1/habits") {
      const input = body as { name: string } & Partial<Omit<FakeHabit, "id" | "name">>;
      const created = fakeHabit(input.name, input);
      state.habits.push(created);
      return json(created, 201);
    }
    const habitMatch = url.pathname.match(/^\/api\/v1\/habits\/(\d+)$/);
    if (habitMatch) {
      const habitId = Number(habitMatch[1]);
      const habit = state.habits.find((h) => h.id === habitId);
      if (!habit) {
        return notFound(`Habit ${habitId} not found`);
      }
      if (method === "PATCH") {
        // Mirror the backend: becoming Numeric requires a goal in the same
        // request, and becoming Boolean sweeps the goal fields back.
        const patch = body as { type?: HabitType; goal?: number };
        if (patch.type === "numeric" && habit.type === "boolean" && patch.goal === undefined) {
          return json(
            {
              error: { code: "invalid_habit", message: "A Numeric habit requires a goal" },
            },
            422,
          );
        }
        Object.assign(habit, body);
        if (habit.type === "boolean") {
          Object.assign(habit, { goal: 1, step: 1, unit: null });
        }
        return json(habit);
      }
      if (method === "DELETE") {
        state.habits = state.habits.filter((h) => h.id !== habitId);
        state.checkIns = state.checkIns.filter((c) => c.habit_id !== habitId);
        return new Response(null, { status: 204 });
      }
    }
    const checkInMatch = url.pathname.match(
      /^\/api\/v1\/habits\/(\d+)\/check-ins\/(\d{4}-\d{2}-\d{2})$/,
    );
    if (checkInMatch) {
      const habitId = Number(checkInMatch[1]);
      const day = checkInMatch[2] as string;
      if (!state.habits.some((h) => h.id === habitId)) {
        return notFound(`Habit ${habitId} not found`);
      }
      const existing = state.checkIns.find((c) => c.habit_id === habitId && c.date === day);
      if (method === "PUT") {
        // Mirror the backend's upsert: one row per (habit, date), whatever
        // the tap count — PUT replaces the day's whole value.
        const value = (body as { value?: number }).value ?? 1;
        if (existing) {
          existing.value = value;
          return json(existing);
        }
        const created: FakeCheckIn = { id: nextCheckInId++, habit_id: habitId, date: day, value };
        state.checkIns.push(created);
        return json(created);
      }
      if (method === "DELETE") {
        if (!existing) {
          return notFound(`No check-in on ${day} for habit ${habitId}`);
        }
        state.checkIns = state.checkIns.filter((c) => c !== existing);
        return new Response(null, { status: 204 });
      }
    }
    if (method === "GET" && url.pathname === "/api/v1/check-ins") {
      const day = url.searchParams.get("date");
      const habitId = url.searchParams.get("habit_id");
      const items = state.checkIns
        .filter(
          (checkIn) =>
            (day === null || checkIn.date === day) &&
            (habitId === null || checkIn.habit_id === Number(habitId)),
        )
        .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
      return json(page(items));
    }
    return notFound(`No route: ${method} ${url.pathname}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return state;
}
