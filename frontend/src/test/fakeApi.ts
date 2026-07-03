import { vi } from "vitest";

export interface FakeList {
  id: number;
  name: string;
  is_inbox: boolean;
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
  tasks: FakeTask[];
  requests: RecordedRequest[];
}

export const INBOX: FakeList = { id: 1, name: "Inbox", is_inbox: true };

let nextTaskId = 100;

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

/** Fakes the HTTP API at the fetch boundary and records every request. */
export function installFakeApi({
  lists = [INBOX],
  tasks = [],
}: { lists?: FakeList[]; tasks?: FakeTask[] } = {}): FakeApiState {
  const state: FakeApiState = { lists, tasks: [...tasks], requests: [] };

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

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    state.requests.push({ method, url: url.pathname + url.search, body });

    if (method === "GET" && url.pathname === "/api/v1/lists") {
      return json(page(state.lists));
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
        return json({ error: { code: "not_found", message: `Task ${taskId} not found` } }, 404);
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
    return json(
      { error: { code: "not_found", message: `No route: ${method} ${url.pathname}` } },
      404,
    );
  });

  vi.stubGlobal("fetch", fetchMock);
  return state;
}
