import { vi } from "vitest";

import { type Priority } from "../api";
import { SORT_GAP } from "../ordering";

export interface FakeList {
  id: number;
  name: string;
  is_inbox: boolean;
  color: string | null;
  emoji: string | null;
  is_archived: boolean;
  folder_id: number | null;
  sort_order: number;
}

export interface FakeFolder {
  id: number;
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
  description: string;
  priority: Priority;
  list_id: number;
  check_items: FakeCheckItem[];
  tags: FakeTag[];
  created_at: string;
}

export interface RecordedRequest {
  method: string;
  url: string;
  body?: unknown;
}

interface FakeApiState {
  lists: FakeList[];
  folders: FakeFolder[];
  tags: FakeTag[];
  tasks: FakeTask[];
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
};

let nextTaskId = 100;
let nextListId = 10;
let nextFolderId = 500;
let nextCheckItemId = 900;
let nextTagId = 700;

export function fakeTask(title: string, overrides: Partial<FakeTask> = {}): FakeTask {
  return {
    id: nextTaskId++,
    title,
    completed: false,
    description: "",
    priority: "none",
    list_id: INBOX.id,
    check_items: [],
    tags: [],
    created_at: "2026-07-03T10:00:00Z",
    ...overrides,
  };
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
    ...overrides,
  };
}

export function fakeFolder(name: string, overrides: Partial<FakeFolder> = {}): FakeFolder {
  const id = nextFolderId++;
  return { id, name, sort_order: id * SORT_GAP, ...overrides };
}

const nextOrder = (rows: { sort_order: number }[]): number =>
  Math.max(0, ...rows.map((row) => row.sort_order)) + SORT_GAP;

/** Fakes the HTTP API at the fetch boundary and records every request. */
export function installFakeApi({
  lists = [INBOX],
  folders = [],
  tags = [],
  tasks = [],
}: {
  lists?: FakeList[];
  folders?: FakeFolder[];
  tags?: FakeTag[];
  tasks?: FakeTask[];
} = {}): FakeApiState {
  const state: FakeApiState = {
    lists: lists.map((list) => ({ ...list })),
    folders: folders.map((folder) => ({ ...folder })),
    tags: tags.map((tag) => ({ ...tag })),
    tasks: tasks.map((task) => ({
      ...task,
      check_items: [...task.check_items],
      tags: task.tags.map((tag) => ({ ...tag })),
    })),
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
      const items = state.tasks.filter(
        (task) =>
          (listId === null || task.list_id === Number(listId)) &&
          (tagId === null || task.tags.some((tag) => tag.id === Number(tagId))),
      );
      return json(page(items));
    }
    if (method === "POST" && url.pathname === "/api/v1/tasks") {
      const created = fakeTask((body as { title: string }).title, {
        list_id: (body as { list_id?: number }).list_id ?? INBOX.id,
      });
      state.tasks.push(created);
      return json(created, 201);
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
        // Mirror the backend rule: ticking the last open item completes the parent.
        if ((body as { done?: boolean }).done === true && task.check_items.every((i) => i.done)) {
          task.completed = true;
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
        const { tag_ids, ...rest } = body as { tag_ids?: number[] } & Record<string, unknown>;
        Object.assign(task, rest);
        if (tag_ids !== undefined) {
          const missing = tag_ids.find((id) => !state.tags.some((tag) => tag.id === id));
          if (missing !== undefined) {
            return notFound(`Tag ${missing} not found`);
          }
          task.tags = state.tags
            .filter((tag) => tag_ids.includes(tag.id))
            .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id)
            .map((tag) => ({ ...tag }));
        }
        return json(task);
      }
      if (method === "DELETE") {
        state.tasks = state.tasks.filter((t) => t.id !== taskId);
        return new Response(null, { status: 204 });
      }
    }
    return notFound(`No route: ${method} ${url.pathname}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return state;
}
