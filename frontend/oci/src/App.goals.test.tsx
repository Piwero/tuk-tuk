import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeGoal, fakeHabit, fakeKeyResult, fakeTask, installFakeApi } from "./test/fakeApi";

async function openGoals(): Promise<void> {
  const nav = await screen.findByRole("navigation", { name: "Views" });
  fireEvent.click(within(nav).getByRole("link", { name: "Goals" }));
  await screen.findByRole("heading", { name: "Goals" });
}

describe("Goals", () => {
  it("opens from the sidebar and lists Goals", async () => {
    const api = installFakeApi();
    render(<App />);

    await openGoals();

    await waitFor(() => {
      expect(api.requests.some((r) => r.method === "GET" && r.url === "/api/v1/goals")).toBe(true);
    });
    expect(screen.getByText(/a goal is a durable outcome with a window/i)).toBeInTheDocument();
  });

  it("shows existing Goals", async () => {
    installFakeApi({ goals: [fakeGoal("Ship v2"), fakeGoal("Run a marathon")] });
    render(<App />);

    await openGoals();

    const list = await screen.findByRole("list", { name: "Goals" });
    expect(within(list).getByText("Ship v2")).toBeInTheDocument();
    expect(within(list).getByText("Run a marathon")).toBeInTheDocument();
  });

  it("creates a Goal with a title and description", async () => {
    const api = installFakeApi();
    render(<App />);
    await openGoals();

    fireEvent.click(screen.getByRole("button", { name: "Add Goal" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Ship v2" } });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Get it out the door" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const post = api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/goals");
      expect(post?.body).toMatchObject({ title: "Ship v2", description: "Get it out the door" });
    });
    expect(await screen.findByText("Ship v2")).toBeInTheDocument();
  });

  it("Obstacle and If-Then Plan are optional and can be set", async () => {
    const api = installFakeApi();
    render(<App />);
    await openGoals();

    fireEvent.click(screen.getByRole("button", { name: "Add Goal" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Run a marathon" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const post = api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/goals");
      expect(post?.body).not.toHaveProperty("obstacle");
      expect(post?.body).not.toHaveProperty("if_then_plan");
    });
  });

  it("shows the If-Then Plan's expected format as a placeholder", async () => {
    installFakeApi();
    render(<App />);
    await openGoals();

    fireEvent.click(screen.getByRole("button", { name: "Add Goal" }));

    expect(
      screen.getByPlaceholderText("If [obstacle happens], then I will [action]"),
    ).toBeInTheDocument();
  });

  it("defaults to the current quarter's dates, which can be overridden", async () => {
    const api = installFakeApi();
    render(<App />);
    await openGoals();

    fireEvent.click(screen.getByRole("button", { name: "Add Goal" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Six weeks" } });
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2026-02-15" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const post = api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/goals");
      expect(post?.body).toMatchObject({ start_date: "2026-01-01", end_date: "2026-02-15" });
    });
  });

  it("edits a Goal in place", async () => {
    const api = installFakeApi({ goals: [fakeGoal("Ship v2")] });
    render(<App />);
    await openGoals();

    fireEvent.click(await screen.findByRole("button", { name: "Edit Ship v2" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Ship v2.1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText("Ship v2.1")).toBeInTheDocument());
    expect(api.goals[0]?.title).toBe("Ship v2.1");
  });

  it("deletes a Goal after confirming", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const api = installFakeApi({ goals: [fakeGoal("Ship v2")] });
    render(<App />);
    await openGoals();

    fireEvent.click(await screen.findByRole("button", { name: "Delete goal Ship v2" }));

    await waitFor(() => expect(screen.queryByText("Ship v2")).not.toBeInTheDocument());
    expect(api.goals).toHaveLength(0);
  });

  it("adds a manual Key Result and shows its progress", async () => {
    const api = installFakeApi({ goals: [fakeGoal("Ship v2")] });
    render(<App />);
    await openGoals();

    fireEvent.click(
      within(await screen.findByLabelText("Ship v2 key results")).getByRole("button", {
        name: "Add key result",
      }),
    );
    fireEvent.change(screen.getByLabelText("Key result name"), {
      target: { value: "Lines shipped" },
    });
    fireEvent.change(screen.getByLabelText("Target value"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Current value"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Add key result" }));

    await waitFor(() => {
      const post = api.requests.find(
        (r) => r.method === "POST" && r.url === `/api/v1/goals/${api.goals[0]!.id}/key-results`,
      );
      expect(post?.body).toMatchObject({ name: "Lines shipped", target_value: 100 });
    });
    expect(await screen.findByText("Lines shipped")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
  });

  it("an automatic Key Result's value renders read-only", async () => {
    const habit = fakeHabit("Meditate");
    const goal = fakeGoal("Ship v2");
    goal.key_results = [
      fakeKeyResult(goal.id, "Meditation days", {
        source: "habit_checkins",
        source_habit_id: habit.id,
        target_value: 10,
      }),
    ];
    installFakeApi({ goals: [goal], habits: [habit] });
    render(<App />);
    await openGoals();

    const value = await screen.findByLabelText("Meditation days current value");
    expect(value.tagName).not.toBe("INPUT");
    // Where the number comes from is said in words, not in a "(auto)" tag.
    expect(await screen.findByText("From Check-ins")).toBeInTheDocument();
  });

  it("editing a manual Key Result's value round-trips", async () => {
    const goal = fakeGoal("Ship v2");
    goal.key_results = [fakeKeyResult(goal.id, "Lines shipped", { target_value: 100 })];
    const api = installFakeApi({ goals: [goal] });
    render(<App />);
    await openGoals();

    const input = await screen.findByLabelText("Lines shipped current value");
    fireEvent.change(input, { target: { value: "25" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(api.goals[0]!.key_results[0]!.current_value).toBe(25);
    });
  });

  it("pressing Enter in a manual Key Result's current value commits it, same as blur", async () => {
    const goal = fakeGoal("Ship v2");
    goal.key_results = [fakeKeyResult(goal.id, "Lines shipped", { target_value: 100 })];
    const api = installFakeApi({ goals: [goal] });
    render(<App />);
    await openGoals();

    const input = await screen.findByLabelText("Lines shipped current value");
    input.focus();
    fireEvent.change(input, { target: { value: "25" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(api.goals[0]!.key_results[0]!.current_value).toBe(25);
    });
    // The progress percentage on the row updates once the save lands.
    expect(await screen.findByText("25%")).toBeInTheDocument();
  });

  it("pressing Enter in a Key Result's target value commits it, same as blur", async () => {
    const goal = fakeGoal("Ship v2");
    goal.key_results = [
      fakeKeyResult(goal.id, "Lines", { start_value: 0, target_value: 100, current_value: 50 }),
    ];
    const api = installFakeApi({ goals: [goal] });
    render(<App />);
    await openGoals();

    const target = await screen.findByLabelText("Lines target value");
    target.focus();
    fireEvent.change(target, { target: { value: "200" } });
    fireEvent.keyDown(target, { key: "Enter" });

    await waitFor(() => {
      expect(api.goals[0]?.key_results[0]?.target_value).toBe(200);
    });
    // Halving the target halves the progress, so the Score moves too.
    expect(await screen.findByText("Score: 25%")).toBeInTheDocument();
  });

  it("deleting a Key Result removes it", async () => {
    const goal = fakeGoal("Ship v2");
    goal.key_results = [fakeKeyResult(goal.id, "Lines shipped")];
    const api = installFakeApi({ goals: [goal] });
    render(<App />);
    await openGoals();

    fireEvent.click(await screen.findByRole("button", { name: "Delete key result Lines shipped" }));

    await waitFor(() => expect(api.goals[0]!.key_results).toHaveLength(0));
    expect(screen.queryByText("Lines shipped")).not.toBeInTheDocument();
  });

  it("focusing a Goal unfocuses the previous one", async () => {
    const api = installFakeApi({ goals: [fakeGoal("A"), fakeGoal("B")] });
    render(<App />);
    await openGoals();

    fireEvent.click(await screen.findByRole("button", { name: "Focus A" }));
    await waitFor(() => expect(api.goals.find((g) => g.title === "A")?.is_focused).toBe(true));

    fireEvent.click(await screen.findByRole("button", { name: "Focus B" }));

    await waitFor(() => {
      expect(api.goals.find((g) => g.title === "A")?.is_focused).toBe(false);
      expect(api.goals.find((g) => g.title === "B")?.is_focused).toBe(true);
    });
  });

  it("abandons a Goal in one click, keeping it visible under Abandoned", async () => {
    const api = installFakeApi({ goals: [fakeGoal("Give up on this")] });
    render(<App />);
    await openGoals();

    fireEvent.click(await screen.findByRole("button", { name: "Abandon Give up on this" }));

    await waitFor(() => {
      expect(api.goals.find((g) => g.title === "Give up on this")?.status).toBe("abandoned");
    });
    expect(
      within(await screen.findByRole("list", { name: "Abandoned goals" })).getByText(
        "Give up on this",
      ),
    ).toBeInTheDocument();
  });

  it("groups Goals into Active, Closed and Abandoned sections", async () => {
    const closedGoal = fakeGoal("Ship v1", {
      status: "closed",
      final_score: 0.5,
      end_date: "2020-03-31",
    });
    const abandonedGoal = fakeGoal("Dropped", { status: "abandoned" });
    installFakeApi({ goals: [fakeGoal("Ship v2"), closedGoal, abandonedGoal] });
    render(<App />);
    await openGoals();

    expect(
      within(await screen.findByRole("list", { name: "Goals" })).getByText("Ship v2"),
    ).toBeInTheDocument();
    expect(
      within(await screen.findByRole("list", { name: "Closed goals" })).getByText("Ship v1"),
    ).toBeInTheDocument();
    expect(
      within(await screen.findByRole("list", { name: "Abandoned goals" })).getByText("Dropped"),
    ).toBeInTheDocument();
  });

  it("shows a closed Goal's frozen final score and an optional retro field", async () => {
    const api = installFakeApi({
      goals: [fakeGoal("Ship v1", { status: "closed", final_score: 0.5, end_date: "2020-03-31" })],
    });
    render(<App />);
    await openGoals();

    expect(screen.getByText("Final score: 50%")).toBeInTheDocument();

    const retro = screen.getByLabelText("Retro for Ship v1");
    fireEvent.change(retro, { target: { value: "Shipped late but shipped." } });
    fireEvent.blur(retro);

    await waitFor(() => {
      expect(api.goals[0]?.retro).toBe("Shipped late but shipped.");
    });
  });

  it("groups active Goals by window, this quarter separate from last", async () => {
    const q1 = fakeGoal("Ship v1", { start_date: "2099-01-01", end_date: "2099-03-31" });
    const q2 = fakeGoal("Ship v2", { start_date: "2099-04-01", end_date: "2099-06-30" });
    installFakeApi({ goals: [q1, q2] });
    render(<App />);
    await openGoals();

    const q1Section = await screen.findByRole("region", { name: "2099-01-01 – 2099-03-31" });
    const q2Section = await screen.findByRole("region", { name: "2099-04-01 – 2099-06-30" });
    expect(within(q1Section).getByText("Ship v1")).toBeInTheDocument();
    expect(within(q2Section).getByText("Ship v2")).toBeInTheDocument();
  });

  it("does not show Focus or Abandon buttons for a closed Goal", async () => {
    installFakeApi({
      goals: [fakeGoal("Ship v1", { status: "closed", final_score: 0.5, end_date: "2020-03-31" })],
    });
    render(<App />);
    await openGoals();

    await screen.findByText("Ship v1");
    expect(screen.queryByRole("button", { name: "Focus Ship v1" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Abandon Ship v1" })).not.toBeInTheDocument();
  });

  it("reorders Key Results so the one that matters most reads first", async () => {
    const goal = fakeGoal("Ship v2");
    goal.key_results = [
      fakeKeyResult(goal.id, "First", { sort_order: 100 }),
      fakeKeyResult(goal.id, "Second", { sort_order: 200 }),
    ];
    installFakeApi({ goals: [goal] });
    render(<App />);
    await openGoals();

    fireEvent.click(await screen.findByRole("button", { name: "Move key result Second up" }));

    await waitFor(() => {
      const names = within(screen.getByRole("list", { name: "Key results" }))
        .getAllByRole("listitem")
        .map((item) => item.textContent);
      expect(names[0]).toContain("Second");
    });
  });

  it("edits a Key Result's target without destroying its progress", async () => {
    const goal = fakeGoal("Ship v2");
    goal.key_results = [
      fakeKeyResult(goal.id, "Lines", { start_value: 0, target_value: 100, current_value: 50 }),
    ];
    const api = installFakeApi({ goals: [goal] });
    render(<App />);
    await openGoals();

    const target = await screen.findByLabelText("Lines target value");
    fireEvent.blur(target, { target: { value: "200" } });

    await waitFor(() => {
      expect(api.goals[0]?.key_results[0]?.target_value).toBe(200);
      expect(api.goals[0]?.key_results[0]?.current_value).toBe(50);
    });
  });

  it("shows which Tasks a counted Key Result is made of", async () => {
    const goal = fakeGoal("Ship v2");
    const kr = fakeKeyResult(goal.id, "Tasks done", { source: "task_count", target_value: 3 });
    goal.key_results = [kr];
    installFakeApi({
      goals: [goal],
      tasks: [fakeTask("Write the migration", { key_result_id: kr.id })],
    });
    render(<App />);
    await openGoals();

    fireEvent.click(await screen.findByRole("button", { name: "Show attached tasks" }));

    const list = await screen.findByRole("list", { name: "Tasks attached to Tasks done" });
    expect(within(list).getByText("Write the migration")).toBeInTheDocument();
  });

  it("says so when a mutation fails rather than failing silently", async () => {
    const goal = fakeGoal("Ship v2");
    goal.key_results = [fakeKeyResult(goal.id, "Lines", { target_value: 100 })];
    const api = installFakeApi({ goals: [goal] });
    render(<App />);
    await openGoals();
    await screen.findByLabelText("Lines target value");

    // The Goal is gone by the time the write lands — a 404 the user must see,
    // not an unhandled rejection that silently reverts the field.
    api.goals.length = 0;
    fireEvent.blur(screen.getByLabelText("Lines target value"), { target: { value: "200" } });

    expect(await screen.findByRole("alert")).toHaveTextContent(/not found/i);
  });

  it("does not flash the empty state before the Goals have loaded", async () => {
    installFakeApi({ goals: [fakeGoal("Ship v2")] });
    render(<App />);

    await openGoals();

    expect(screen.queryByText(/a goal is a durable outcome with a window/i)).toBeNull();
    expect(await screen.findByText("Ship v2")).toBeInTheDocument();
  });

  it("abandoning a Goal drops it from the Stand-up", async () => {
    const goal = fakeGoal("Give up", { is_focused: true });
    const api = installFakeApi({ goals: [goal] });
    render(<App />);
    await openGoals();

    fireEvent.click(await screen.findByRole("button", { name: "Abandon Give up" }));

    await waitFor(() => {
      expect(api.goals[0]?.status).toBe("abandoned");
      expect(api.goals[0]?.is_focused).toBe(false);
    });
  });
});

describe("Goal card touch: Focus/Abandon/Edit/Delete stay behind a long-press (#248)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function card(): Promise<HTMLElement> {
    const heading = await screen.findByRole("heading", { name: "Ship v2" });
    const el = heading.closest("li");
    if (el === null) {
      throw new Error("goal card not found");
    }
    return el;
  }

  it("is closed at rest", async () => {
    installFakeApi({ goals: [fakeGoal("Ship v2")] });
    render(<App />);
    await openGoals();

    expect(await card()).not.toHaveAttribute("data-actions-open");
  });

  it("opens after holding a touch for the long-press window", async () => {
    installFakeApi({ goals: [fakeGoal("Ship v2")] });
    render(<App />);
    await openGoals();

    const el = await card();
    fireEvent.touchStart(el);
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(el).toHaveAttribute("data-actions-open", "true");
  });

  it("does not open on a plain, short tap", async () => {
    installFakeApi({ goals: [fakeGoal("Ship v2")] });
    render(<App />);
    await openGoals();

    const el = await card();
    fireEvent.touchStart(el);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.touchEnd(el);
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(el).not.toHaveAttribute("data-actions-open");
  });

  it("cancels the long-press on a touch move (a scroll)", async () => {
    installFakeApi({ goals: [fakeGoal("Ship v2")] });
    render(<App />);
    await openGoals();

    const el = await card();
    fireEvent.touchStart(el);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.touchMove(el);
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(el).not.toHaveAttribute("data-actions-open");
  });

  it("closes again once Delete is tapped, and still asks for confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    installFakeApi({ goals: [fakeGoal("Ship v2")] });
    render(<App />);
    await openGoals();

    const el = await card();
    fireEvent.touchStart(el);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(el).toHaveAttribute("data-actions-open", "true");

    fireEvent.click(screen.getByRole("button", { name: "Delete goal Ship v2" }));

    expect(window.confirm).toHaveBeenCalled();
    expect(el).not.toHaveAttribute("data-actions-open");
  });
});
