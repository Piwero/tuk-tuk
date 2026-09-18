import { useCallback, useEffect, useState } from "react";

import {
  createGoal,
  createKeyResult,
  deleteGoal,
  deleteKeyResult,
  fetchGoals,
  fetchHabits,
  updateGoal,
  updateKeyResult,
  type Goal,
  type GoalCreateInput,
  type Habit,
  type KeyResult,
  type KeyResultSource,
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

interface KeyResultFormValues {
  name: string;
  source: KeyResultSource;
  start_value: string;
  target_value: string;
  current_value: string;
  source_habit_id: string;
}

const BLANK_KEY_RESULT: KeyResultFormValues = {
  name: "",
  source: "manual",
  start_value: "0",
  target_value: "1",
  current_value: "0",
  source_habit_id: "",
};

/** A Goal's Key Results: list with progress, add form, and per-row edit /
 * delete. Automatic sources (habit_checkins, task_count) render their value
 * read-only (ADR 0012) — only "manual" Key Results get an editable value. */
function KeyResultsPanel({
  goal,
  habits,
  onCreate,
  onUpdate,
  onDelete,
}: {
  goal: Goal;
  habits: Habit[];
  onCreate: (values: KeyResultFormValues) => Promise<void>;
  onUpdate: (
    keyResultId: number,
    patch: { target_value?: number; current_value?: number },
  ) => Promise<void>;
  onDelete: (keyResultId: number) => Promise<void>;
}): JSX.Element {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<KeyResultFormValues>(BLANK_KEY_RESULT);

  function set<K extends keyof KeyResultFormValues>(key: K, value: KeyResultFormValues[K]): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="key-results" aria-label={`${goal.title} key results`}>
      {goal.score !== null && <p className="goal-score">Score: {Math.round(goal.score * 100)}%</p>}
      {goal.key_results.length > 0 && (
        <ul aria-label="Key results">
          {goal.key_results.map((kr: KeyResult) => (
            <li key={kr.id} className="key-result">
              <span>{kr.name}</span>
              <span>{Math.round(kr.ratio * 100)}%</span>
              {kr.source === "manual" ? (
                <input
                  aria-label={`${kr.name} current value`}
                  type="number"
                  defaultValue={kr.current_value}
                  onBlur={(event) =>
                    void onUpdate(kr.id, { current_value: Number(event.target.value) })
                  }
                />
              ) : (
                <span aria-label={`${kr.name} current value`} className="key-result-readonly">
                  {kr.current_value} (auto)
                </span>
              )}
              <button
                type="button"
                aria-label={`Delete key result ${kr.name}`}
                onClick={() => void onDelete(kr.id)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <form
          className="key-result-form"
          onSubmit={(event) => {
            event.preventDefault();
            void onCreate(draft).then(() => {
              setDraft(BLANK_KEY_RESULT);
              setAdding(false);
            });
          }}
        >
          <label>
            Name
            <input
              aria-label="Key result name"
              value={draft.name}
              onChange={(event) => set("name", event.target.value)}
              required
            />
          </label>
          <label>
            Source
            <select
              aria-label="Key result source"
              value={draft.source}
              onChange={(event) => set("source", event.target.value as KeyResultSource)}
            >
              <option value="manual">Manual</option>
              <option value="habit_checkins">Habit check-ins</option>
              <option value="task_count">Task count</option>
            </select>
          </label>
          {draft.source === "habit_checkins" && (
            <label>
              Habit
              <select
                aria-label="Source habit"
                value={draft.source_habit_id}
                onChange={(event) => set("source_habit_id", event.target.value)}
                required
              >
                <option value="">Choose a habit…</option>
                {habits.map((habit) => (
                  <option key={habit.id} value={habit.id}>
                    {habit.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Start value
            <input
              aria-label="Start value"
              type="number"
              value={draft.start_value}
              onChange={(event) => set("start_value", event.target.value)}
            />
          </label>
          <label>
            Target value
            <input
              aria-label="Target value"
              type="number"
              value={draft.target_value}
              onChange={(event) => set("target_value", event.target.value)}
            />
          </label>
          {draft.source === "manual" && (
            <label>
              Current value
              <input
                aria-label="Current value"
                type="number"
                value={draft.current_value}
                onChange={(event) => set("current_value", event.target.value)}
              />
            </label>
          )}
          <div className="key-result-form-actions">
            <button type="submit">Add key result</button>
            <button type="button" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setAdding(true)}>
          Add key result
        </button>
      )}
    </div>
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

/** The Goals view: list, create, edit, delete, Key Results, and focus
 * (ADR 0012). Self-fetching, like the Habits and Stand-up views. */
export function GoalsView(): JSX.Element {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [editor, setEditor] = useState<Editor>(null);

  const load = useCallback(async (): Promise<void> => {
    const page = await fetchGoals();
    setGoals(page.items);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void fetchHabits().then((page) => setHabits(page.items));
  }, []);

  async function handleCreateKeyResult(goal: Goal, values: KeyResultFormValues): Promise<void> {
    const updated = await createKeyResult(goal.id, {
      name: values.name,
      source: values.source,
      start_value: Number(values.start_value),
      target_value: Number(values.target_value),
      ...(values.source === "manual" ? { current_value: Number(values.current_value) } : {}),
      ...(values.source === "habit_checkins" && values.source_habit_id !== ""
        ? { source_habit_id: Number(values.source_habit_id) }
        : {}),
    });
    setGoals((current) => current.map((g) => (g.id === updated.id ? updated : g)));
  }

  async function handleUpdateKeyResult(
    goal: Goal,
    keyResultId: number,
    patch: { target_value?: number; current_value?: number },
  ): Promise<void> {
    const updated = await updateKeyResult(goal.id, keyResultId, patch);
    setGoals((current) => current.map((g) => (g.id === updated.id ? updated : g)));
  }

  async function handleDeleteKeyResult(goal: Goal, keyResultId: number): Promise<void> {
    await deleteKeyResult(goal.id, keyResultId);
    await load();
  }

  async function handleToggleFocus(goal: Goal): Promise<void> {
    await updateGoal(goal.id, { is_focused: !goal.is_focused });
    await load();
  }

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
              <li key={goal.id} className={goal.is_focused ? "goal goal-focused" : "goal"}>
                <h3>
                  {goal.title}
                  {goal.is_focused && <span className="goal-focused-badge">Focused</span>}
                </h3>
                {goal.description !== "" && <p>{goal.description}</p>}
                <p className="goal-window">
                  {goal.start_date ?? "No window"} – {goal.end_date ?? ""}
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
                <KeyResultsPanel
                  goal={goal}
                  habits={habits}
                  onCreate={(values) => handleCreateKeyResult(goal, values)}
                  onUpdate={(keyResultId, patch) => handleUpdateKeyResult(goal, keyResultId, patch)}
                  onDelete={(keyResultId) => handleDeleteKeyResult(goal, keyResultId)}
                />
                <div className="goal-actions">
                  <button
                    type="button"
                    aria-label={goal.is_focused ? `Unfocus ${goal.title}` : `Focus ${goal.title}`}
                    onClick={() => void handleToggleFocus(goal)}
                  >
                    {goal.is_focused ? "Unfocus" : "Focus"}
                  </button>
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
