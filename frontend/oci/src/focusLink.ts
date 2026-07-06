/** The Focus link select's encoding of "at most one link": "", "task:7" or
 * "habit:3". A Focus Session belongs to a Task or a Habit, never both. */

export type FocusLink = "" | `task:${number}` | `habit:${number}`;

export function linkOf(session: { task_id: number | null; habit_id: number | null }): FocusLink {
  if (session.task_id !== null) {
    return `task:${session.task_id}`;
  }
  if (session.habit_id !== null) {
    return `habit:${session.habit_id}`;
  }
  return "";
}

export function linkFields(link: FocusLink): { task_id?: number; habit_id?: number } {
  const [kind, id] = link.split(":");
  if (kind === "task") {
    return { task_id: Number(id) };
  }
  if (kind === "habit") {
    return { habit_id: Number(id) };
  }
  return {};
}
