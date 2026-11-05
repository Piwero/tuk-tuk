import { RpcError } from "livekit-client";

import {
  fetchCalendarEvents,
  fetchHabits,
  fetchLists,
  fetchSearchTasks,
  fetchSmartTasks,
  fetchTags,
  fetchTask,
  type Task,
} from "../api";
import { localDayOf } from "../dates";
import type { VoiceRoom } from "./session";

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
  const end = new Date(`${today}T00:00:00`);
  end.setDate(end.getDate() + 6);
  const windowEnd = localDayOf(end);
  const [taskPage, habitPage, events, lists, tags] = await Promise.all([
    fetchSmartTasks("next7", today, EMPTY),
    fetchHabits(today),
    fetchCalendarEvents(today, windowEnd).catch(() => ({ events: [], failures: [] })),
    fetchLists(),
    fetchTags(),
  ]);
  taskPage.items.forEach((task) => writableTaskIds.add(task.id));
  habitPage.items.forEach((habit) => writableHabitIds.add(habit.id));
  return {
    today,
    window_end: windowEnd,
    time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    tasks: taskPage.items.map(brief),
    tasks_total: taskPage.total,
    habits_due_today: habitPage.items.map(({ id, name }) => ({ id, name })),
    events: events.events,
    lists: lists.items.map(({ id, name }) => ({ id, name })),
    tags: tags.items.map(({ id, name }) => ({ id, name })),
  };
}

export function registerVoiceReads(room: VoiceRoom, refresh?: () => void): void {
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
  };
  for (const [name, handler] of Object.entries(handlers))
    room.registerRpcMethod(name, async ({ payload }) => {
      try {
        return JSON.stringify(await handler(JSON.parse(payload) as Record<string, unknown>));
      } catch (error) {
        throw new RpcError(1500, error instanceof Error ? error.message : "Voice read failed", "");
      }
    });
  void refresh;
}
