import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeList, fakeTag, fakeTask } from "../test/fakeApi";
import { TaskRow, type TaskRowProps } from "./TaskRow";

function renderRow(overrides: Partial<TaskRowProps> = {}): ReturnType<typeof render> {
  const props: TaskRowProps = {
    task: fakeTask("Buy milk"),
    showDate: true,
    showTags: true,
    showCheckProgress: true,
    onToggle: vi.fn(),
    onSelect: vi.fn(),
    ...overrides,
  };
  return render(
    <ul className="tasks">
      <TaskRow {...props} />
    </ul>,
  );
}

describe("TaskRow", () => {
  it("puts the title on its own row, separate from any metadata", () => {
    const task = fakeTask("Buy milk tomorrow at 5pm", {
      due_date: "2026-08-16T17:00:00Z",
      tags: [fakeTag("work")],
    });
    renderRow({ task });

    const row = screen
      .getByRole("button", { name: "Open details for Buy milk tomorrow at 5pm" })
      .closest("li");
    if (row === null) {
      throw new Error("row not found");
    }
    const head = row.querySelector(".task-row-head");
    const meta = row.querySelector(".task-row-meta");
    expect(head).not.toBeNull();
    expect(meta).not.toBeNull();
    // The title lives in the head line; metadata lives in the separate meta
    // line below it — they never compete for the same horizontal space.
    expect(head?.contains(screen.getByRole("button", { name: /Open details for/ }))).toBe(true);
    expect(meta?.textContent).toContain("work");
  });

  it("toggles completion from the checkbox", () => {
    const onToggle = vi.fn();
    const task = fakeTask("Buy milk");
    renderRow({ task, onToggle });

    fireEvent.click(screen.getByRole("checkbox", { name: "Complete Buy milk" }));

    expect(onToggle).toHaveBeenCalledWith(task);
  });

  it("opens details from the title", () => {
    const onSelect = vi.fn();
    const task = fakeTask("Buy milk");
    renderRow({ task, onSelect });

    fireEvent.click(screen.getByRole("button", { name: "Open details for Buy milk" }));

    expect(onSelect).toHaveBeenCalledWith(task.id);
  });

  it("shows a description indicator only when the task has one", () => {
    renderRow({ task: fakeTask("No notes", { description: "" }) });
    expect(screen.queryByLabelText("Has a description")).not.toBeInTheDocument();

    renderRow({ task: fakeTask("With notes", { description: "Remember the eggs" }) });
    expect(screen.getByLabelText("Has a description")).toBeInTheDocument();
  });

  it("shows the task's List only when one is passed", () => {
    const list = fakeList("Errands");
    const { rerender } = renderRow({ task: fakeTask("Buy milk") });
    expect(screen.queryByText("Errands")).not.toBeInTheDocument();

    rerender(
      <ul className="tasks">
        <TaskRow
          task={fakeTask("Buy milk")}
          list={list}
          showDate
          showTags
          showCheckProgress
          onToggle={vi.fn()}
          onSelect={vi.fn()}
        />
      </ul>,
    );
    expect(screen.getByText("Errands")).toBeInTheDocument();
  });

  it("hides date, tags and Check Item counter when their prop is false", () => {
    const task = fakeTask("Buy milk", {
      due_date: "2026-08-16T17:00:00Z",
      tags: [fakeTag("errand")],
      check_items: [{ id: 1, title: "Milk", done: false, sort_order: 0 }],
    });
    renderRow({ task, showDate: false, showTags: false, showCheckProgress: false });

    expect(screen.queryByText("errand")).not.toBeInTheDocument();
    expect(screen.queryByText("0/1")).not.toBeInTheDocument();
  });

  it("shows the Check Item counter when showCheckProgress is true", () => {
    const task = fakeTask("Buy milk", {
      check_items: [
        { id: 1, title: "Milk", done: true, sort_order: 0 },
        { id: 2, title: "Eggs", done: false, sort_order: 1 },
      ],
    });
    renderRow({ task });

    expect(screen.getByText("1/2")).toBeInTheDocument();
  });

  it("renders Focus and Delete only when their handlers are supplied", () => {
    const task = fakeTask("Buy milk");
    renderRow({ task });
    expect(
      screen.queryByRole("button", { name: "Start Focus for Buy milk" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Buy milk" })).not.toBeInTheDocument();

    renderRow({ task, onStartFocus: vi.fn(), onDelete: vi.fn() });
    expect(screen.getByRole("button", { name: "Start Focus for Buy milk" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Buy milk" })).toBeInTheDocument();
  });

  it("calls onStartFocus and onDelete with the task", () => {
    const onStartFocus = vi.fn();
    const onDelete = vi.fn();
    const task = fakeTask("Buy milk");
    renderRow({ task, onStartFocus, onDelete });

    fireEvent.click(screen.getByRole("button", { name: "Start Focus for Buy milk" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Buy milk" }));

    expect(onStartFocus).toHaveBeenCalledWith(task);
    expect(onDelete).toHaveBeenCalledWith(task);
  });

  it("flags priority and overdue state on the row for styling", () => {
    const overdue = fakeTask("Late", {
      due_date: "2020-01-01T00:00:00Z",
      is_all_day: true,
      priority: "high",
    });
    renderRow({ task: overdue });

    const row = screen.getByRole("button", { name: "Open details for Late" }).closest("li");
    expect(row).toHaveAttribute("data-priority", "high");
    expect(row).toHaveAttribute("data-overdue", "true");
  });
});

describe("TaskRow touch: Focus/Delete stay behind a long-press (#168)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function row(): HTMLElement {
    const el = screen.getByRole("button", { name: /^Open details for/ }).closest("li");
    if (el === null) {
      throw new Error("row not found");
    }
    return el;
  }

  it("is closed at rest, even with Focus/Delete wired up", () => {
    renderRow({ onStartFocus: vi.fn(), onDelete: vi.fn() });
    expect(row()).not.toHaveAttribute("data-actions-open");
  });

  it("opens after holding a touch for the long-press window", () => {
    renderRow({ onStartFocus: vi.fn(), onDelete: vi.fn() });

    fireEvent.touchStart(row());
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(row()).toHaveAttribute("data-actions-open", "true");
  });

  it("does not open on a plain, short tap", () => {
    renderRow({ onStartFocus: vi.fn(), onDelete: vi.fn() });

    fireEvent.touchStart(row());
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.touchEnd(row());
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(row()).not.toHaveAttribute("data-actions-open");
  });

  it("cancels the long-press on a touch move (a scroll or drag)", () => {
    renderRow({ onStartFocus: vi.fn(), onDelete: vi.fn() });

    fireEvent.touchStart(row());
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.touchMove(row());
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(row()).not.toHaveAttribute("data-actions-open");
  });

  it("closes again once something in the row is tapped", () => {
    const onDelete = vi.fn();
    renderRow({ onStartFocus: vi.fn(), onDelete });

    fireEvent.touchStart(row());
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(row()).toHaveAttribute("data-actions-open", "true");

    fireEvent.click(screen.getByRole("button", { name: /^Delete/ }));

    expect(onDelete).toHaveBeenCalled();
    expect(row()).not.toHaveAttribute("data-actions-open");
  });
});

describe("TaskRow within a list", () => {
  it("renders each task's row inside the same ul", () => {
    const first = fakeTask("First");
    const second = fakeTask("Second");
    render(
      <ul className="tasks" aria-label="Tasks">
        <TaskRow
          task={first}
          showDate
          showTags
          showCheckProgress
          onToggle={vi.fn()}
          onSelect={vi.fn()}
        />
        <TaskRow
          task={second}
          showDate
          showTags
          showCheckProgress
          onToggle={vi.fn()}
          onSelect={vi.fn()}
        />
      </ul>,
    );

    const list = screen.getByRole("list", { name: "Tasks" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });
});
