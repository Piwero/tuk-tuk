import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeGoal, fakeHabit, fakeKeyResult, installFakeApi } from "./test/fakeApi";

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
    expect(value).toHaveTextContent("(auto)");
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
});
