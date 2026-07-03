const BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export interface TaskList {
  id: number;
  name: string;
  is_inbox: boolean;
}

export interface Task {
  id: number;
  title: string;
  completed: boolean;
  list_id: number;
  created_at: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    const body = (await response.json()) as ApiErrorBody;
    throw new ApiError(body.error.code, body.error.message);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function fetchLists(): Promise<Page<TaskList>> {
  return request("/api/v1/lists");
}

export function fetchTasks(listId: number): Promise<Page<Task>> {
  return request(`/api/v1/tasks?list_id=${listId}`);
}

export function createTask(title: string, listId?: number): Promise<Task> {
  return request("/api/v1/tasks", {
    method: "POST",
    body: JSON.stringify(listId === undefined ? { title } : { title, list_id: listId }),
  });
}

export function updateTask(taskId: number, patch: { completed?: boolean }): Promise<Task> {
  return request(`/api/v1/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteTask(taskId: number): Promise<void> {
  return request(`/api/v1/tasks/${taskId}`, { method: "DELETE" });
}
