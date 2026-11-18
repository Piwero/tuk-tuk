import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { pickDate } from "./test/pickDate";
import { fakeDataTransfer } from "./test/dnd";
import { fakeGoal, fakeHabit, fakeKeyResult, fakeTask, installFakeApi } from "./test/fakeApi";

async function openGoals(): Promise<void> {
  const nav = await screen.findByRole("navigation", { name: "Views" });
  fireEvent.click(within(nav).getByRole("link", { name: "Goals" }));
  await screen.findByRole("heading", { name: "Goals" });
}

/** Opens a Goal's overflow menu and returns the chosen item. */
async function goalAction(goal: string, item: string): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("button", { name: `Actions for ${goal}` }));
  const menu = await screen.findByRole("menu", { name: `Actions for ${goal}` });
  return within(menu).getByRole("menuitem", { name: item });
}

/** Opens a Key Result's overflow menu and returns the chosen item. */
async function keyResultAction(kr: string, item: string): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("button", { name: `Actions for key result ${kr}` }));
  const menu = await screen.findByRole("menu", { name: `Actions for key result ${kr}` });
  return within(menu).getByRole("menuitem", { name: item });
}

describe("Goals", () => {
  it("shows readable window, days left, Score and today's pace with the plan", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 6, 3, 12));
    const api = installFakeApi({
      goals: [
        fakeGoal("Ship", {
          start_date: "2026-07-01",
          end_date: "2026-07-05",
          is_focused: true,
          obstacle: "Interruptions",
          if_then_plan: "If interrupted, then I will close chat.",
          key_results: [fakeKeyResult(1, "Build", { target_value: 100, current_value: 25 })],
        }),
      ],
    });
    try {
      render(<App />);
      await openGoals();
      expect(
        await screen.findByText("Jul 1, 2026 – Jul 5, 2026 · 2 days left"),
      ).toBeInTheDocument();
      expect(screen.getByRole("progressbar", { name: "Ship Score" })).toHaveAttribute(
        "aria-valuenow",
        "25",
      );
      expect(screen.getByLabelText("Today's pace: 50%")).toBeInTheDocument();
      expect(screen.getByText("25 percentage points behind pace")).toBeInTheDocument();
      expect(screen.getByText("Focused")).toBeInTheDocument();
      expect(
        screen.getByText(
          (_, el) =>
            el?.className === "goal-obstacle" && el.textContent === "Obstacle: Interruptions",
        ),
      ).toBeInTheDocument();
      // #466: the If-Then Plan gets its own labelled line, never run on after the Obstacle.
      expect(
        screen.getByText(
          (_, el) =>
            el?.className === "goal-if-then" &&
            el.textContent === "If-Then Plan: If interrupted, then I will close chat.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/2026-07-/)).not.toBeInTheDocument();
      expect(api.requests.some((r) => r.method === "GET" && r.url === "/api/v1/goals")).toBe(true);
      expect(api.requests.filter((r) => r.method !== "GET")).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
  it("shows an unmeasured Goal with no pace verdict", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 6, 3, 12));
    installFakeApi({
      goals: [fakeGoal("Ship", { start_date: "2026-07-01", end_date: "2026-07-05" })],
    });
    try {
      render(<App />);
      await openGoals();
      expect(await screen.findByText("No Key Results yet — unmeasured.")).toBeInTheDocument();
      expect(screen.queryByRole("progressbar", { name: "Ship Score" })).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/Today's pace/)).not.toBeInTheDocument();
      expect(screen.queryByText(/pace/)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a settled Goal's final score with no pace marker", async () => {
    installFakeApi({
      goals: [
        fakeGoal("Ship", {
          status: "closed",
          final_score: 0.75,
          start_date: "2026-01-01",
          end_date: "2026-03-31",
          key_results: [fakeKeyResult(1, "Build", { target_value: 100, current_value: 75 })],
        }),
      ],
    });
    render(<App />);
    await openGoals();
    expect(await screen.findByText("Final score: 75%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Ship Score" })).toHaveAttribute(
      "aria-valuenow",
      "75",
    );
    expect(screen.queryByLabelText(/Today's pace/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ahead of pace|behind pace|On pace/)).not.toBeInTheDocument();
  });

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
    expect(document.querySelector('input[type="date"]')).toBeNull();
    pickDate("Start date", "2026-01-01");
    pickDate("End date", "2026-02-15");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const post = api.requests.find((r) => r.method === "POST" && r.url === "/api/v1/goals");
      expect(post?.body).toMatchObject({ start_date: "2026-01-01", end_date: "2026-02-15" });
    });
  });

  it("says blank dates default to the current quarter", async () => {
    installFakeApi();
    render(<App />);
    await openGoals();

    fireEvent.click(screen.getByRole("button", { name: "Add Goal" }));

    expect(screen.getByText(/blank uses the current quarter/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start date" })).toHaveTextContent("No date");
    expect(screen.getByRole("button", { name: "End date" })).toHaveTextContent("No date");
  });

  it("edits a Goal in place", async () => {
    const api = installFakeApi({ goals: [fakeGoal("Ship v2")] });
    render(<App />);
    await openGoals();

    fireEvent.click(await goalAction("Ship v2", "Edit Ship v2"));
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

    fireEvent.click(await goalAction("Ship v2", "Delete goal Ship v2"));

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
    expect(screen.getByText("40 of 100")).toBeInTheDocument();
  });

  it("explains itself when Habit check-ins is chosen with no Habits", async () => {
    const goal = fakeGoal("Ship v2");
    installFakeApi({ goals: [goal], habits: [] });
    render(<App />);
    await openGoals();

    fireEvent.click(
      within(await screen.findByLabelText("Ship v2 key results")).getByRole("button", {
        name: "Add key result",
      }),
    );
    fireEvent.change(screen.getByLabelText("Key result source"), {
      target: { value: "habit_checkins" },
    });

    expect(screen.queryByLabelText("Source habit")).not.toBeInTheDocument();
    expect(screen.getByText(/no habits exist yet/i)).toBeInTheDocument();
    expect(screen.getByText(/no habits exist yet/i)).toHaveTextContent(/habits/i);
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

    await screen.findByText("0 of 10");
    expect(screen.queryByLabelText("Meditation days current value")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Add 1 to Meditation days/ })).toBeNull();
    // Where the number comes from is said in words, not in a "(auto)" tag.
    expect(await screen.findByText("From Check-ins")).toBeInTheDocument();
  });

  it("editing a manual Key Result's value round-trips", async () => {
    const goal = fakeGoal("Ship v2");
    goal.key_results = [fakeKeyResult(goal.id, "Lines shipped", { target_value: 100 })];
    const api = installFakeApi({ goals: [goal] });
    render(<App />);
    await openGoals();

    fireEvent.click(
      await screen.findByRole("button", { name: "Edit Lines shipped current value" }),
    );
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

    fireEvent.click(
      await screen.findByRole("button", { name: "Edit Lines shipped current value" }),
    );
    const input = await screen.findByLabelText("Lines shipped current value");
    fireEvent.change(input, { target: { value: "25" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(api.goals[0]!.key_results[0]!.current_value).toBe(25);
    });
    // The row's 'current of target' updates once the save lands.
    expect(await screen.findByText("25 of 100")).toBeInTheDocument();
  });

  it("pressing Enter in a Key Result's target value commits it, same as blur", async () => {
    const goal = fakeGoal("Ship v2");
    goal.key_results = [
      fakeKeyResult(goal.id, "Lines", { start_value: 0, target_value: 100, current_value: 50 }),
    ];
    const api = installFakeApi({ goals: [goal] });
    render(<App />);
    await openGoals();

    fireEvent.click(await keyResultAction("Lines", "Edit Lines target value"));
    const target = await screen.findByLabelText("Lines target value");
    fireEvent.change(target, { target: { value: "200" } });
    fireEvent.keyDown(target, { key: "Enter" });

    await waitFor(() => {
      expect(api.goals[0]?.key_results[0]?.target_value).toBe(200);
    });
    // Halving the target halves the progress, so the Score moves too.
    expect(await screen.findByText("Score: 25%")).toBeInTheDocument();
  });

  it("says a Goal with no Key Results is unmeasured, not scored", async () => {
    installFakeApi({ goals: [fakeGoal("Ship v2")] });
    render(<App />);
    await openGoals();

    expect(await screen.findByText(/no key results yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/score:/i)).not.toBeInTheDocument();
  });

  it("replaces the unmeasured line with a Score once a Key Result exists", async () => {
    const goal = fakeGoal("Ship v2");
    goal.key_results = [fakeKeyResult(goal.id, "Lines shipped", { target_value: 100 })];
    installFakeApi({ goals: [goal] });
    render(<App />);
    await openGoals();

    expect(await screen.findByText("Score: 0%")).toBeInTheDocument();
    expect(screen.queryByText(/no key results yet/i)).not.toBeInTheDocument();
  });

  it("deleting a Key Result removes it", async () => {
    const goal = fakeGoal("Ship v2");
    goal.key_results = [fakeKeyResult(goal.id, "Lines shipped")];
    const api = installFakeApi({ goals: [goal] });
    render(<App />);
    await openGoals();

    fireEvent.click(await keyResultAction("Lines shipped", "Delete key result Lines shipped"));

    await waitFor(() => expect(api.goals[0]!.key_results).toHaveLength(0));
    expect(screen.queryByText("Lines shipped")).not.toBeInTheDocument();
  });

  it("focusing a Goal unfocuses the previous one", async () => {
    const api = installFakeApi({ goals: [fakeGoal("A"), fakeGoal("B")] });
    render(<App />);
    await openGoals();

    fireEvent.click(await goalAction("A", "Focus A"));
    await waitFor(() => expect(api.goals.find((g) => g.title === "A")?.is_focused).toBe(true));

    fireEvent.click(await goalAction("B", "Focus B"));

    await waitFor(() => {
      expect(api.goals.find((g) => g.title === "A")?.is_focused).toBe(false);
      expect(api.goals.find((g) => g.title === "B")?.is_focused).toBe(true);
    });
  });

  it("abandons a Goal in one click, keeping it visible under Abandoned", async () => {
    const api = installFakeApi({ goals: [fakeGoal("Give up on this")] });
    render(<App />);
    await openGoals();

    fireEvent.click(await goalAction("Give up on this", "Abandon Give up on this"));

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

    const q1Section = await screen.findByRole("region", { name: "Jan 1, 2099 – Mar 31, 2099" });
    const q2Section = await screen.findByRole("region", { name: "Apr 1, 2099 – Jun 30, 2099" });
    expect(within(q1Section).getByText("Ship v1")).toBeInTheDocument();
    expect(within(q2Section).getByText("Ship v2")).toBeInTheDocument();
  });

  it("does not show Focus or Abandon buttons for a closed Goal", async () => {
    installFakeApi({
      goals: [fakeGoal("Ship v1", { status: "closed", final_score: 0.5, end_date: "2020-03-31" })],
    });
    render(<App />);
    await openGoals();

    fireEvent.click(await screen.findByRole("button", { name: "Actions for Ship v1" }));
    const menu = await screen.findByRole("menu", { name: "Actions for Ship v1" });
    expect(within(menu).queryByRole("menuitem", { name: "Focus Ship v1" })).not.toBeInTheDocument();
    expect(
      within(menu).queryByRole("menuitem", { name: "Abandon Ship v1" }),
    ).not.toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Edit Ship v1" })).toBeInTheDocument();
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

    fireEvent.click(await keyResultAction("Second", "Move key result Second up"));

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

    fireEvent.click(await keyResultAction("Lines", "Edit Lines target value"));
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
    fireEvent.click(await keyResultAction("Lines", "Edit Lines target value"));
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

    fireEvent.click(await goalAction("Give up", "Abandon Give up"));

    await waitFor(() => {
      expect(api.goals[0]?.status).toBe("abandoned");
      expect(api.goals[0]?.is_focused).toBe(false);
    });
  });
});

describe("Key Result rows (#464)", () => {
  it("shows no number inputs or up, down and remove buttons at rest", async () => {
    const goal = fakeGoal("Ship v2");
    goal.key_results = [
      fakeKeyResult(goal.id, "First", { target_value: 10 }),
      fakeKeyResult(goal.id, "Second", { target_value: 10 }),
    ];
    installFakeApi({ goals: [goal] });
    render(<App />);
    await openGoals();

    const panel = await screen.findByLabelText("Ship v2 key results");
    await within(panel).findByText("First");
    expect(within(panel).queryAllByRole("spinbutton")).toHaveLength(0);
    expect(within(panel).queryByRole("button", { name: /^Move key result/ })).toBeNull();
    expect(within(panel).queryByRole("button", { name: /^Delete key result/ })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^(Edit|Delete goal|Abandon|Focus) Ship v2$/ }),
    ).toBeNull();
  });

  it("the stepper adds one to a manual Key Result", async () => {
    const goal = fakeGoal("Ship v2");
    goal.key_results = [fakeKeyResult(goal.id, "Lines", { target_value: 10, current_value: 3 })];
    const api = installFakeApi({ goals: [goal] });
    render(<App />);
    await openGoals();

    fireEvent.click(await screen.findByRole("button", { name: "Add 1 to Lines" }));

    await waitFor(() => expect(api.goals[0]!.key_results[0]!.current_value).toBe(4));
    expect(await screen.findByText("4 of 10")).toBeInTheDocument();
  });

  it("names the source of an automatic Key Result", async () => {
    const goal = fakeGoal("Ship v2");
    goal.key_results = [fakeKeyResult(goal.id, "Done", { source: "task_count", target_value: 3 })];
    installFakeApi({ goals: [goal] });
    render(<App />);
    await openGoals();

    expect(await screen.findByText("From completed Tasks")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add 1 to Done" })).toBeNull();
  });

  it("dragging a Key Result onto another moves it before that one", async () => {
    const goal = fakeGoal("Ship v2");
    goal.key_results = [
      fakeKeyResult(goal.id, "First", { sort_order: 1024 }),
      fakeKeyResult(goal.id, "Second", { sort_order: 2048 }),
      fakeKeyResult(goal.id, "Third", { sort_order: 3072 }),
    ];
    installFakeApi({ goals: [goal] });
    render(<App />);
    await openGoals();

    const list = await screen.findByRole("list", { name: "Key results" });
    const row = (name: string): HTMLElement =>
      within(list).getByText(name).closest("li") as HTMLElement;
    const dataTransfer = fakeDataTransfer();
    fireEvent.dragStart(row("Third"), { dataTransfer });
    fireEvent.drop(row("First"), { dataTransfer });

    await waitFor(() => {
      const names = within(screen.getByRole("list", { name: "Key results" }))
        .getAllByRole("listitem")
        .map((item) => item.querySelector(".key-result-name")?.textContent);
      expect(names).toEqual(["Third", "First", "Second"]);
    });
  });
});

describe("Goal actions menu (#464)", () => {
  it("holds Unfocus, Abandon, Edit and Delete for a focused active Goal", async () => {
    installFakeApi({ goals: [fakeGoal("Ship v2", { is_focused: true })] });
    render(<App />);
    await openGoals();

    fireEvent.click(await screen.findByRole("button", { name: "Actions for Ship v2" }));
    const menu = await screen.findByRole("menu", { name: "Actions for Ship v2" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Unfocus", "Abandon", "Edit", "Delete"]);
  });

  it("the card no longer carries a long-press reveal", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      installFakeApi({ goals: [fakeGoal("Ship v2")] });
      render(<App />);
      await openGoals();
      const el = (await screen.findByRole("heading", { name: "Ship v2" })).closest("li")!;
      fireEvent.touchStart(el);
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(el).not.toHaveAttribute("data-actions-open");
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes once Delete is chosen, and still asks for confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    installFakeApi({ goals: [fakeGoal("Ship v2")] });
    render(<App />);
    await openGoals();

    fireEvent.click(await goalAction("Ship v2", "Delete goal Ship v2"));

    expect(window.confirm).toHaveBeenCalled();
    expect(screen.queryByRole("menu", { name: "Actions for Ship v2" })).toBeNull();
  });
});
