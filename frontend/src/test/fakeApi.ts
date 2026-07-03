import { vi } from "vitest";

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

export interface FakeTask {
  id: number;
  title: string;
  completed: boolean;
  list_id: number;
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

export function fakeTask(title: string, overrides: Partial<FakeTask> = {}): FakeTask {
  return {
    id: nextTaskId++,
    title,
    completed: false,
    list_id: INBOX.id,
    created_at: "2026-07-03T10:00:00Z",
    ...overrides,
  };
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
  tasks = [],
}: { lists?: FakeList[]; folders?: FakeFolder[]; tasks?: FakeTask[] } = {}): FakeApiState {
  const state: FakeApiState = {
    lists: lists.map((list) => ({ ...list })),
    folders: folders.map((folder) => ({ ...folder })),
    tasks: [...tasks],
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
      const items = state.tasks.filter(
        (task) => listId === null || task.list_id === Number(listId),
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
    const taskMatch = url.pathname.match(/^\/api\/v1\/tasks\/(\d+)$/);
    if (taskMatch) {
      const taskId = Number(taskMatch[1]);
      const task = state.tasks.find((t) => t.id === taskId);
      if (!task) {
        return notFound(`Task ${taskId} not found`);
      }
      if (method === "PATCH") {
        Object.assign(task, body);
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
