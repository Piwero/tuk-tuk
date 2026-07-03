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
  view_mode: ViewMode;
}

export interface Folder {
  id: number;
  name: string;
  sort_order: number;
}

export type Priority = "none" | "low" | "medium" | "high";

/** How a List is displayed: flat or as a Kanban board of its Sections. */
export type ViewMode = "list" | "kanban";

export interface Tag {
  id: number;
  name: string;
  color: string | null;
}

export interface CheckItem {
  id: number;
  title: string;
  done: boolean;
  sort_order: number;
}

export interface Section {
  id: number;
  list_id: number;
  name: string;
  sort_order: number;
}

export interface Task {
  id: number;
  title: string;
  completed: boolean;
  /** When the task was last completed; orders the completed view, newest first. */
  completed_at: string | null;
  description: string;
  priority: Priority;
  list_id: number;
  section_id: number | null;
  sort_order: number;
  /** Schedule: UTC instants; all-day values are date-only semantics at T00:00:00Z. */
  start_date: string | null;
  due_date: string | null;
  is_all_day: boolean;
  /** IANA timezone the task was scheduled in (v1 writes the browser timezone). */
  time_zone: string | null;
  check_items: CheckItem[];
  tags: Tag[];
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
  view_mode?: ViewMode;
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

export function fetchTasksByTag(tagId: number): Promise<Page<Task>> {
  return request(`/api/v1/tasks?tag_id=${tagId}`);
}

/** The built-in Smart Lists — computed queries, never storage. */
export type SmartView = "today" | "next7" | "all";

/** Display names of the built-in Smart Lists, in sidebar order. */
export const SMART_LABELS: Record<SmartView, string> = {
  today: "Today",
  next7: "Next 7 Days",
  all: "All",
};

/** `today` is the caller's local day (YYYY-MM-DD); Smart Lists are open tasks only. */
export function fetchSmartTasks(view: SmartView, today: string): Promise<Page<Task>> {
  return request(`/api/v1/tasks?view=${view}&today=${today}`);
}

/** The completed view: per List, or across all Lists when listId is null. */
export function fetchCompletedTasks(listId: number | null): Promise<Page<Task>> {
  const scope = listId === null ? "" : `&list_id=${listId}`;
  return request(`/api/v1/tasks?completed=true${scope}`);
}

export function fetchSections(listId: number): Promise<Page<Section>> {
  return request(`/api/v1/sections?list_id=${listId}`);
}

export function createSection(listId: number, name: string): Promise<Section> {
  return request("/api/v1/sections", {
    method: "POST",
    body: JSON.stringify({ list_id: listId, name }),
  });
}

/** Absent fields stay unchanged; explicit null is rejected by the API. */
export interface SectionPatch {
  name?: string;
  sort_order?: number;
}

export function updateSection(sectionId: number, patch: SectionPatch): Promise<Section> {
  return request(`/api/v1/sections/${sectionId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteSection(sectionId: number): Promise<void> {
  return request(`/api/v1/sections/${sectionId}`, { method: "DELETE" });
}

export function fetchTags(): Promise<Page<Tag>> {
  return request("/api/v1/tags");
}

export interface TagCreateInput {
  name: string;
  color?: string;
}

export function createTag(input: TagCreateInput): Promise<Tag> {
  return request("/api/v1/tags", { method: "POST", body: JSON.stringify(input) });
}

/** Absent fields stay unchanged; explicit null clears color. */
export interface TagPatch {
  name?: string;
  color?: string | null;
}

export function updateTag(tagId: number, patch: TagPatch): Promise<Tag> {
  return request(`/api/v1/tags/${tagId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function deleteTag(tagId: number): Promise<void> {
  return request(`/api/v1/tags/${tagId}`, { method: "DELETE" });
}

export function createTask(title: string, listId?: number, sectionId?: number): Promise<Task> {
  return request("/api/v1/tasks", {
    method: "POST",
    body: JSON.stringify({
      title,
      ...(listId === undefined ? {} : { list_id: listId }),
      ...(sectionId === undefined ? {} : { section_id: sectionId }),
    }),
  });
}

/** Absent fields stay unchanged; explicit null is rejected by the API,
 * except section_id, where null moves the task out of its Section, and
 * start_date / due_date / time_zone, where null clears the schedule.
 * tag_ids replaces the task's whole tag set. */
export interface TaskPatch {
  title?: string;
  completed?: boolean;
  list_id?: number;
  description?: string;
  priority?: Priority;
  tag_ids?: number[];
  section_id?: number | null;
  sort_order?: number;
  start_date?: string | null;
  due_date?: string | null;
  is_all_day?: boolean;
  time_zone?: string | null;
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
