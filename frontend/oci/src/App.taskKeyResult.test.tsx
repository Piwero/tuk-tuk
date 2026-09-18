import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { fakeGoal, fakeKeyResult, fakeTask, installFakeApi } from "./test/fakeApi";

afterEach(() => {
  vi.restoreAllMocks();
});

async function openTaskDetail(title: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: `Open details for ${title}` }));
  await screen.findByRole("complementary", { name: "Task details" });
}

describe("Task-sourced Key Results (issue #236)", () => {
  it("attaches a Task to a Key Result from the Task form", async () => {
    const goal = fakeGoal("Ship v2");
    goal.key_results = [fakeKeyResult(goal.id, "Tasks done", { source: "task_count" })];
    const api = installFakeApi({ goals: [goal], tasks: [fakeTask("Write code")] });
    render(<App />);
    await openTaskDetail("Write code");

    const picker = await screen.findByLabelText("Key result");
    fireEvent.change(picker, { target: { value: String(goal.key_results[0]!.id) } });

    await waitFor(() => {
      expect(api.tasks.find((t) => t.title === "Write code")?.key_result_id).toBe(
        goal.key_results[0]!.id,
      );
    });
  });

  it("shows the option labelled with the Goal and Key Result name", async () => {
    const goal = fakeGoal("Ship v2");
    goal.key_results = [fakeKeyResult(goal.id, "Tasks done", { source: "task_count" })];
    installFakeApi({ goals: [goal], tasks: [fakeTask("Write code")] });
    render(<App />);
    await openTaskDetail("Write code");

    const picker = await screen.findByLabelText("Key result");
    expect(picker).toHaveTextContent("Ship v2: Tasks done");
  });

  it("detaches a Task by picking 'No Key Result'", async () => {
    const goal = fakeGoal("Ship v2");
    const kr = fakeKeyResult(goal.id, "Tasks done", { source: "task_count" });
    goal.key_results = [kr];
    const task = fakeTask("Write code", { key_result_id: kr.id });
    const api = installFakeApi({ goals: [goal], tasks: [task] });
    render(<App />);
    await openTaskDetail("Write code");

    const picker = await screen.findByLabelText("Key result");
    expect(picker).toHaveValue(String(kr.id));
    fireEvent.change(picker, { target: { value: "" } });

    await waitFor(() => {
      expect(api.tasks.find((t) => t.title === "Write code")?.key_result_id).toBeNull();
    });
  });

  it("does not offer manual or habit-sourced Key Results as picker options", async () => {
    const goal = fakeGoal("Ship v2");
    goal.key_results = [
      fakeKeyResult(goal.id, "Manual KR", { source: "manual" }),
      fakeKeyResult(goal.id, "Countable", { source: "task_count" }),
    ];
    installFakeApi({ goals: [goal], tasks: [fakeTask("Write code")] });
    render(<App />);
    await openTaskDetail("Write code");

    const picker = await screen.findByLabelText("Key result");
    expect(picker).not.toHaveTextContent("Manual KR");
    expect(picker).toHaveTextContent("Countable");
  });
});
