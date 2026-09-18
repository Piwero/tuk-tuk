import { useCallback, useEffect, useState } from "react";

import {
  createGoal,
  deleteGoal,
  fetchGoals,
  updateGoal,
  type Goal,
  type GoalCreateInput,
} from "../api";

interface GoalFormValues {
  title: string;
  description: string;
  obstacle: string;
  if_then_plan: string;
  start_date: string;
  end_date: string;
}

function valuesOf(goal: Goal): GoalFormValues {
  return {
    title: goal.title,
    description: goal.description,
    obstacle: goal.obstacle ?? "",
    if_then_plan: goal.if_then_plan ?? "",
    start_date: goal.start_date,
    end_date: goal.end_date,
  };
}

const BLANK_VALUES: GoalFormValues = {
  title: "",
  description: "",
  obstacle: "",
  if_then_plan: "",
  start_date: "",
  end_date: "",
};

interface GoalFormProps {
  initial?: GoalFormValues;
  onSubmit: (values: GoalFormValues) => void;
  onCancel: () => void;
}

/** The create/edit form. Obstacle and If-Then Plan are optional (WOOP,
 * ADR 0012) — the If-Then Plan field shows the expected format so what gets
 * written is an implementation intention, not a vague note. Blank dates on
 * create default to the current quarter, filled in server-side. */
function GoalForm({ initial, onSubmit, onCancel }: GoalFormProps): JSX.Element {
  const [values, setValues] = useState<GoalFormValues>(initial ?? BLANK_VALUES);

  function set<K extends keyof GoalFormValues>(key: K, value: GoalFormValues[K]): void {
    setValues((current) => ({ ...current, [key]: value }));
  }

  return (
    <form
      className="goal-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(values);
      }}
    >
      <label>
        Title
        <input
          value={values.title}
          onChange={(event) => set("title", event.target.value)}
          required
        />
      </label>
      <label>
        Description
        <textarea
          value={values.description}
          onChange={(event) => set("description", event.target.value)}
        />
      </label>
      <label>
        Obstacle
        <textarea
          placeholder="What's likely to get in the way?"
          value={values.obstacle}
          onChange={(event) => set("obstacle", event.target.value)}
        />
      </label>
      <label>
        If-Then Plan
        <textarea
          placeholder="If [obstacle happens], then I will [action]"
          value={values.if_then_plan}
          onChange={(event) => set("if_then_plan", event.target.value)}
        />
      </label>
      <label>
        Start date
        <input
          type="date"
          value={values.start_date}
          onChange={(event) => set("start_date", event.target.value)}
        />
      </label>
      <label>
        End date
        <input
          type="date"
          value={values.end_date}
          onChange={(event) => set("end_date", event.target.value)}
        />
      </label>
      <div className="goal-form-actions">
        <button type="submit">Save</button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function toCreateInput(values: GoalFormValues): GoalCreateInput {
  return {
    title: values.title,
    description: values.description,
    ...(values.obstacle === "" ? {} : { obstacle: values.obstacle }),
    ...(values.if_then_plan === "" ? {} : { if_then_plan: values.if_then_plan }),
    ...(values.start_date === "" ? {} : { start_date: values.start_date }),
    ...(values.end_date === "" ? {} : { end_date: values.end_date }),
  };
}

type Editor = { mode: "create" } | { mode: "edit"; goalId: number } | null;

/** The Goals view: list, create, edit, delete — no Key Results yet (issue
 * #232). Self-fetching, like the Habits and Stand-up views. */
export function GoalsView(): JSX.Element {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [editor, setEditor] = useState<Editor>(null);

  const load = useCallback(async (): Promise<void> => {
    const page = await fetchGoals();
    setGoals(page.items);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(values: GoalFormValues): Promise<void> {
    await createGoal(toCreateInput(values));
    setEditor(null);
    await load();
  }

  async function handleEdit(goal: Goal, values: GoalFormValues): Promise<void> {
    await updateGoal(goal.id, {
      title: values.title,
      description: values.description,
      obstacle: values.obstacle === "" ? null : values.obstacle,
      if_then_plan: values.if_then_plan === "" ? null : values.if_then_plan,
      start_date: values.start_date,
      end_date: values.end_date,
    });
    setEditor(null);
    await load();
  }

  async function handleDelete(goal: Goal): Promise<void> {
    const confirmed = window.confirm(`Delete the goal "${goal.title}"?`);
    if (!confirmed) {
      return;
    }
    await deleteGoal(goal.id);
    await load();
  }

  return (
    <div className="goals-view">
      {goals.length === 0 && editor === null ? (
        <p className="goals-empty-hint">
          A Goal is a durable outcome with a window — add one below to start tracking it.
        </p>
      ) : (
        <ul className="goals-list" aria-label="Goals">
          {goals.map((goal) =>
            editor?.mode === "edit" && editor.goalId === goal.id ? (
              <li key={goal.id} className="goal-editing">
                <GoalForm
                  initial={valuesOf(goal)}
                  onSubmit={(values) => void handleEdit(goal, values)}
                  onCancel={() => setEditor(null)}
                />
              </li>
            ) : (
              <li key={goal.id} className="goal">
                <h3>{goal.title}</h3>
                {goal.description !== "" && <p>{goal.description}</p>}
                <p className="goal-window">
                  {goal.start_date} – {goal.end_date}
                </p>
                {goal.obstacle !== null && (
                  <p className="goal-obstacle">
                    <strong>Obstacle:</strong> {goal.obstacle}
                  </p>
                )}
                {goal.if_then_plan !== null && (
                  <p className="goal-if-then">
                    <strong>If-Then Plan:</strong> {goal.if_then_plan}
                  </p>
                )}
                <div className="goal-actions">
                  <button
                    type="button"
                    aria-label={`Edit ${goal.title}`}
                    onClick={() => setEditor({ mode: "edit", goalId: goal.id })}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete goal ${goal.title}`}
                    onClick={() => void handleDelete(goal)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
      {editor?.mode === "create" ? (
        <GoalForm
          onSubmit={(values) => void handleCreate(values)}
          onCancel={() => setEditor(null)}
        />
      ) : (
        <button type="button" onClick={() => setEditor({ mode: "create" })}>
          Add Goal
        </button>
      )}
    </div>
  );
}
