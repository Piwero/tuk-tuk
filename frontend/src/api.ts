const BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export interface TaskList {
  id: number;
  name: string;
  is_inbox: boolean;
  color: string | null;
  emoji: string | null;
  is_archived: boolean;
  folder_id: number | null;
  sort_order: number;
}

export interface Folder {
  id: number;
  name: string;
  sort_order: number;
}

export type Priority = "none" | "low" | "medium" | "high";

export interface CheckItem {
  id: number;
  title: string;
  done: boolean;
  sort_order: number;
}

export interface Task {
  id: number;
  title: string;
  completed: boolean;
  description: string;
  priority: Priority;
  list_id: number;
  check_items: CheckItem[];
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

export interface ListCreateInput {
  name: string;
  color?: string;
  emoji?: string;
}

export function createList(input: ListCreateInput): Promise<TaskList> {
  return request("/api/v1/lists", { method: "POST", body: JSON.stringify(input) });
}

/** Absent fields stay unchanged; null clears color/emoji or moves the List out of its Folder. */
export interface ListPatch {
  name?: string;
  color?: string | null;
  emoji?: string | null;
  is_archived?: boolean;
  folder_id?: number | null;
  sort_order?: number;
}

export function updateList(listId: number, patch: ListPatch): Promise<TaskList> {
  return request(`/api/v1/lists/${listId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteList(listId: number): Promise<void> {
  return request(`/api/v1/lists/${listId}`, { method: "DELETE" });
}

export function fetchFolders(): Promise<Page<Folder>> {
  return request("/api/v1/folders");
}

export function createFolder(name: string): Promise<Folder> {
  return request("/api/v1/folders", { method: "POST", body: JSON.stringify({ name }) });
}

/** Absent fields stay unchanged; explicit null is rejected by the API. */
export interface FolderPatch {
  name?: string;
  sort_order?: number;
}

export function updateFolder(folderId: number, patch: FolderPatch): Promise<Folder> {
  return request(`/api/v1/folders/${folderId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteFolder(folderId: number): Promise<void> {
  return request(`/api/v1/folders/${folderId}`, { method: "DELETE" });
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

/** Absent fields stay unchanged; explicit null is rejected by the API. */
export interface TaskPatch {
  title?: string;
  completed?: boolean;
  list_id?: number;
  description?: string;
  priority?: Priority;
}

export function updateTask(taskId: number, patch: TaskPatch): Promise<Task> {
  return request(`/api/v1/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteTask(taskId: number): Promise<void> {
  return request(`/api/v1/tasks/${taskId}`, { method: "DELETE" });
}

/** Check Item mutations return the full parent Task (composition). */
export function createCheckItem(taskId: number, title: string): Promise<Task> {
  return request(`/api/v1/tasks/${taskId}/check-items`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

/** Absent fields stay unchanged; explicit null is rejected by the API. */
export interface CheckItemPatch {
  title?: string;
  done?: boolean;
  sort_order?: number;
}

export function updateCheckItem(
  taskId: number,
  checkItemId: number,
  patch: CheckItemPatch,
): Promise<Task> {
  return request(`/api/v1/tasks/${taskId}/check-items/${checkItemId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteCheckItem(taskId: number, checkItemId: number): Promise<void> {
  return request(`/api/v1/tasks/${taskId}/check-items/${checkItemId}`, { method: "DELETE" });
}
