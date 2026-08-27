import { describe, expect, it } from "vitest";

import { type Task } from "./api";
import { deriveOpenTaskCounts, folderOpenCount, openCountLabel } from "./openCounts";

const TODAY = "2026-07-03";

function task(overrides: Partial<Task> & { id: number; list_id: number }): Task {
  return {
    title: "t",
    completed: false,
    completed_at: null,
    description: "",
    priority: "none",
    section_id: null,
    sort_order: 0,
    start_date: null,
    due_date: null,
    is_all_day: true,
    time_zone: null,
    reminders: [],
    recurrence: null,
    source_google_calendar_id: null,
    source_google_event_id: null,
    check_items: [],
    tags: [],
    created_at: `${TODAY}T00:00:00Z`,
    ...overrides,
  };
}

describe("deriveOpenTaskCounts", () => {
  it("counts open Tasks per List and ignores completed ones", () => {
    const counts = deriveOpenTaskCounts(
      [
        task({ id: 1, list_id: 10 }),
        task({ id: 2, list_id: 10 }),
        task({ id: 3, list_id: 20 }),
        task({ id: 4, list_id: 20, completed: true }),
      ],
      TODAY,
    );
    expect(counts.byList.get(10)).toBe(2);
    expect(counts.byList.get(20)).toBe(1);
    expect(counts.byList.has(999)).toBe(false);
    expect(counts.smart.all).toBe(3);
  });

  it("scopes Today to due-or-overdue and Next 7 Days to the coming week", () => {
    const counts = deriveOpenTaskCounts(
      [
        task({ id: 1, list_id: 10, due_date: "2026-07-01T00:00:00Z" }), // overdue
        task({ id: 2, list_id: 10, due_date: "2026-07-03T00:00:00Z" }), // today
        task({ id: 3, list_id: 10, due_date: "2026-07-08T00:00:00Z" }), // within the week
        task({ id: 4, list_id: 10, due_date: "2026-08-01T00:00:00Z" }), // far off
        task({ id: 5, list_id: 10 }), // unscheduled
      ],
      TODAY,
    );
    // Today takes everything due today or earlier; Next 7 Days is the forward
    // window only (overdue stays out), mirroring the backend's smart-view rule.
    expect(counts.smart.today).toBe(2);
    expect(counts.smart.next7).toBe(2);
    expect(counts.smart.all).toBe(5);
  });
});

describe("folderOpenCount", () => {
  it("sums the counts of the Lists inside the Folder", () => {
    const byList = new Map([
      [10, 2],
      [20, 3],
      [30, 1],
    ]);
    expect(folderOpenCount(byList, [10, 20])).toBe(5);
    expect(folderOpenCount(byList, [])).toBe(0);
    expect(folderOpenCount(byList, [40])).toBe(0);
  });
});

describe("openCountLabel", () => {
  it("singularises one task", () => {
    expect(openCountLabel(1)).toBe("1 open task");
    expect(openCountLabel(4)).toBe("4 open tasks");
  });
});
