import { useCallback, useEffect, useState } from "react";

import {
  ApiError,
  createGoal,
  createKeyResult,
  deleteGoal,
  deleteKeyResult,
  fetchGoals,
  fetchHabits,
  fetchTasksByKeyResult,
  updateGoal,
  updateKeyResult,
  type Goal,
  type GoalCreateInput,
  type Habit,
  type KeyResult,
  type KeyResultPatch,
  type KeyResultSource,
  type Task,
} from "../api";
import { useLongPressReveal } from "../longPressReveal";
import { Hint } from "./Hint";
import { Icon } from "./Icon";

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
    start_date: goal.start_date ?? "",
    end_date: goal.end_date ?? "",
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
      <p className="goal-form-date-hint">Blank uses the current quarter.</p>
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

/** Where an automatic Key Result's number comes from, said plainly — system
 * copy carries no jargon and no emoji (design system, Content rules). */
const SOURCE_NOTE: Record<KeyResultSource, string> = {
  manual: "",
  habit_checkins: "From Check-ins",
  task_count: "From completed Tasks",
};

/** One Key Result row: name, progress, its value, and the controls that
 * reorder or remove it. A "task_count" row can expand to show the Tasks its
 * count is made of, so the number can be checked rather than trusted. */
function KeyResultRow({
  keyResult: kr,
  isFirst,
  isLast,
  onUpdate,
  onMove,
  onDelete,
}: {
  keyResult: KeyResult;
  isFirst: boolean;
  isLast: boolean;
  onUpdate: (keyResultId: number, patch: KeyResultPatch) => void;
  onMove: (keyResultId: number, direction: -1 | 1) => void;
  onDelete: (keyResultId: number) => void;
}): JSX.Element {
  const [showTasks, setShowTasks] = useState(false);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const percent = Math.round(kr.ratio * 100);

  useEffect(() => {
    if (!showTasks) {
      return;
    }
    void fetchTasksByKeyResult(kr.id).then((page) => setTasks(page.items));
  }, [showTasks, kr.id, kr.current_value]);

  return (
    <li className="key-result">
      <div className="key-result-row">
        <span className="key-result-name">{kr.name}</span>
        <span className="key-result-progress" aria-label={`${kr.name} progress`}>
          {percent}%
        </span>
        <span
          className="key-result-meter"
          aria-hidden="true"
          style={{ ["--kr-fill" as string]: `${Math.min(100, percent)}%` }}
        />
        {kr.source === "manual" ? (
          <input
            aria-label={`${kr.name} current value`}
            type="number"
            defaultValue={kr.current_value}
            onBlur={(event) => onUpdate(kr.id, { current_value: Number(event.target.value) })}
            onKeyDown={(event) => {
              // Enter commits through the same blur handler above — one
              // write path, not two (issue #246).
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
          />
        ) : (
          <span
            aria-label={`${kr.name} current value`}
            className="key-result-readonly"
            title={SOURCE_NOTE[kr.source]}
          >
            {kr.current_value}
          </span>
        )}
        <input
          aria-label={`${kr.name} target value`}
          className="key-result-target"
          type="number"
          defaultValue={kr.target_value}
          onBlur={(event) => onUpdate(kr.id, { target_value: Number(event.target.value) })}
          onKeyDown={(event) => {
            // Enter commits through the same blur handler above — one write
            // path, not two (issue #246).
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
        <div className="key-result-actions">
          <button
            type="button"
            aria-label={`Move key result ${kr.name} up`}
            disabled={isFirst}
            onClick={() => onMove(kr.id, -1)}
          >
            <Icon name="chevron-up" size={16} />
          </button>
          <button
            type="button"
            aria-label={`Move key result ${kr.name} down`}
            disabled={isLast}
            onClick={() => onMove(kr.id, 1)}
          >
            <Icon name="chevron-down" size={16} />
          </button>
          <button
            type="button"
            aria-label={`Delete key result ${kr.name}`}
            onClick={() => onDelete(kr.id)}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      </div>
      {kr.source !== "manual" && <p className="key-result-source">{SOURCE_NOTE[kr.source]}</p>}
      {kr.source === "task_count" && (
        <>
          <button
            type="button"
            className="key-result-tasks-toggle"
            aria-expanded={showTasks}
            onClick={() => setShowTasks((current) => !current)}
          >
            {showTasks ? "Hide attached tasks" : "Show attached tasks"}
          </button>
          {showTasks && (
            <ul className="key-result-tasks" aria-label={`Tasks attached to ${kr.name}`}>
              {tasks !== null && tasks.length === 0 && (
                <li className="key-result-tasks-empty">No tasks attached yet.</li>
              )}
              {(tasks ?? []).map((task) => (
                <li key={task.id}>
                  {task.title}
                  {task.completed && <Icon name="check" size={14} />}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  );
}

/** A Goal's Key Results: list with progress, add form, and per-row edit /
 * reorder / delete. Automatic sources (habit_checkins, task_count) render
 * their value read-only (ADR 0012) — only "manual" Key Results get an
 * editable value; the target is editable on every Key Result. */
function KeyResultsPanel({
  goal,
  habits,
  onCreate,
  onUpdate,
  onMove,
  onDelete,
}: {
  goal: Goal;
  habits: Habit[];
  onCreate: (values: KeyResultFormValues) => void;
  onUpdate: (keyResultId: number, patch: KeyResultPatch) => void;
  onMove: (keyResultId: number, direction: -1 | 1) => void;
  onDelete: (keyResultId: number) => void;
}): JSX.Element {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<KeyResultFormValues>(BLANK_KEY_RESULT);

  function set<K extends keyof KeyResultFormValues>(key: K, value: KeyResultFormValues[K]): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="key-results" aria-label={`${goal.title} key results`}>
      {goal.score !== null ? (
        <Hint hintKey="score">
          <p className="goal-score" tabIndex={0}>
            Score: {Math.round(goal.score * 100)}%
          </p>
        </Hint>
      ) : (
        <p className="goal-score-unmeasured">No Key Results yet — unmeasured.</p>
      )}
      {goal.key_results.length > 0 && (
        <Hint hintKey="key-result">
          <ul aria-label="Key results" tabIndex={0}>
            {goal.key_results.map((kr: KeyResult, index: number) => (
              <KeyResultRow
                key={kr.id}
                keyResult={kr}
                isFirst={index === 0}
                isLast={index === goal.key_results.length - 1}
                onUpdate={onUpdate}
                onMove={onMove}
                onDelete={onDelete}
              />
            ))}
          </ul>
        </Hint>
      )}
      {adding ? (
        <form
          className="key-result-form"
          onSubmit={(event) => {
            event.preventDefault();
            onCreate(draft);
            setDraft(BLANK_KEY_RESULT);
            setAdding(false);
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
          {draft.source === "habit_checkins" &&
            (habits.length > 0 ? (
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
            ) : (
              <p className="key-result-no-habits">
                No Habits exist yet. Create one in Habits first.
              </p>
            ))}
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

/** Groups active Goals by their (start, end) window — "this quarter's
 * commitments read separately from last quarter's" (ADR 0012, issue #234).
 * A windowless Goal (the Sprint Goal seed) gets its own "No window" group.
 * Preserves first-seen order. */
function groupByWindow(goals: Goal[]): [string, Goal[]][] {
  const groups = new Map<string, Goal[]>();
  for (const goal of goals) {
    const key =
      goal.start_date === null || goal.end_date === null
        ? "No window"
        : `${goal.start_date} – ${goal.end_date}`;
    const group = groups.get(key);
    if (group) {
      group.push(goal);
    } else {
      groups.set(key, [goal]);
    }
  }
  return [...groups.entries()];
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

/** A Goal card, at rest and revealed. On touch, Focus/Abandon/Edit/Delete
 * stay behind the same long-press gesture as a Task row (#168, #245): a
 * plain tap never opens them and a touch move (a scroll) cancels the
 * press, so an unreachable-on-touch action group never becomes an
 * accidentally-triggered one. Hover and focus-within reveal them too
 * (#247), unchanged by this. */
function GoalCard({
  goal,
  habits,
  onCreateKeyResult,
  onUpdateKeyResult,
  onMoveKeyResult,
  onDeleteKeyResult,
  onRetro,
  onToggleFocus,
  onAbandon,
  onEdit,
  onDelete,
}: {
  goal: Goal;
  habits: Habit[];
  onCreateKeyResult: (values: KeyResultFormValues) => void;
  onUpdateKeyResult: (keyResultId: number, patch: KeyResultPatch) => void;
  onMoveKeyResult: (keyResultId: number, direction: -1 | 1) => void;
  onDeleteKeyResult: (keyResultId: number) => void;
  onRetro: (retro: string) => void;
  onToggleFocus: () => void;
  onAbandon: () => void;
  onEdit: () => void;
  onDelete: () => void;
}): JSX.Element {
  const reveal = useLongPressReveal();

  return (
    <li
      className={goal.is_focused ? "goal goal-focused" : "goal"}
      data-actions-open={reveal.dataActionsOpen}
      onTouchStart={reveal.onTouchStart}
      onTouchEnd={reveal.onTouchEnd}
      onTouchMove={reveal.onTouchMove}
      onTouchCancel={reveal.onTouchCancel}
      onClick={reveal.onClick}
    >
      <h3>
        {goal.title}
        {goal.is_focused && <span className="goal-focused-badge">Focused</span>}
      </h3>
      {goal.description !== "" && <p>{goal.description}</p>}
      <p className="goal-window">
        {goal.start_date === null || goal.end_date === null
          ? "No window"
          : `${goal.start_date} – ${goal.end_date}`}
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
        onCreate={onCreateKeyResult}
        onUpdate={onUpdateKeyResult}
        onMove={onMoveKeyResult}
        onDelete={onDeleteKeyResult}
      />
      {goal.status === "closed" && goal.final_score !== null && (
        <p className="goal-final-score">Final score: {Math.round(goal.final_score * 100)}%</p>
      )}
      {goal.status === "closed" && (
        <label className="goal-retro">
          Retro
          <textarea
            aria-label={`Retro for ${goal.title}`}
            placeholder="What did I learn? (optional)"
            defaultValue={goal.retro ?? ""}
            onBlur={(event) => onRetro(event.target.value)}
          />
        </label>
      )}
      <div className="goal-actions">
        {goal.status === "active" && (
          <>
            <Hint hintKey="focused-goal">
              <button
                type="button"
                aria-pressed={goal.is_focused}
                aria-label={goal.is_focused ? `Unfocus ${goal.title}` : `Focus ${goal.title}`}
                onClick={onToggleFocus}
              >
                <Icon name="target" size={16} />
                {goal.is_focused ? "Unfocus" : "Focus"}
              </button>
            </Hint>
            <Hint hintKey="abandon" destructive>
              <button type="button" aria-label={`Abandon ${goal.title}`} onClick={onAbandon}>
                <Icon name="x" size={16} />
                Abandon
              </button>
            </Hint>
          </>
        )}
        <button type="button" aria-label={`Edit ${goal.title}`} onClick={onEdit}>
          <Icon name="pencil" size={16} />
          Edit
        </button>
        <button type="button" aria-label={`Delete goal ${goal.title}`} onClick={onDelete}>
          <Icon name="trash-2" size={16} />
          Delete
        </button>
      </div>
    </li>
  );
}

type Editor = { mode: "create" } | { mode: "edit"; goalId: number } | null;

/** The Goals view: list, create, edit, delete, Key Results, and focus
 * (ADR 0012). Self-fetching, like the Habits and Stand-up views. */
export function GoalsView(): JSX.Element {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [editor, setEditor] = useState<Editor>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const page = await fetchGoals();
    setGoals(page.items);
    setLoaded(true);
  }, []);

  /** Every mutation goes through here: a failure says so in the view rather
   * than rejecting into nothing. The 409 on writing an automatic Key Result's
   * value (ADR 0012) is an expected outcome, not a crash. */
  const run = useCallback(
    (work: () => Promise<void>): void => {
      setError(null);
      void work().catch((cause: unknown) => {
        setError(cause instanceof ApiError ? cause.message : "Something went wrong. Try again.");
        void load();
      });
    },
    [load],
  );

  useEffect(() => {
    void load().catch(() => {
      setError("Couldn't load your goals.");
      setLoaded(true);
    });
  }, [load]);

  useEffect(() => {
    void fetchHabits()
      .then((page) => setHabits(page.items))
      .catch(() => setHabits([]));
  }, []);

  function handleCreateKeyResult(goal: Goal, values: KeyResultFormValues): void {
    run(async () => {
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
    });
  }

  function handleUpdateKeyResult(goal: Goal, keyResultId: number, patch: KeyResultPatch): void {
    run(async () => {
      const updated = await updateKeyResult(goal.id, keyResultId, patch);
      setGoals((current) => current.map((g) => (g.id === updated.id ? updated : g)));
    });
  }

  /** Reorder by swapping sort_order with the neighbour in the direction of
   * travel — the list is already served in sort_order, so a swap is the whole
   * move. */
  function handleMoveKeyResult(goal: Goal, keyResultId: number, direction: -1 | 1): void {
    const index = goal.key_results.findIndex((kr) => kr.id === keyResultId);
    const neighbour = goal.key_results[index + direction];
    const moving = goal.key_results[index];
    if (neighbour === undefined || moving === undefined) {
      return;
    }
    run(async () => {
      await updateKeyResult(goal.id, moving.id, { sort_order: neighbour.sort_order });
      const updated = await updateKeyResult(goal.id, neighbour.id, {
        sort_order: moving.sort_order,
      });
      setGoals((current) => current.map((g) => (g.id === updated.id ? updated : g)));
    });
  }

  function handleDeleteKeyResult(goal: Goal, keyResultId: number): void {
    run(async () => {
      await deleteKeyResult(goal.id, keyResultId);
      await load();
    });
  }

  function handleToggleFocus(goal: Goal): void {
    run(async () => {
      await updateGoal(goal.id, { is_focused: !goal.is_focused });
      // A full reload, not a splice: focusing one Goal unfocuses the other.
      await load();
    });
  }

  function handleCreate(values: GoalFormValues): void {
    run(async () => {
      await createGoal(toCreateInput(values));
      setEditor(null);
      await load();
    });
  }

  function handleEdit(goal: Goal, values: GoalFormValues): void {
    run(async () => {
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
    });
  }

  function handleDelete(goal: Goal): void {
    const confirmed = window.confirm(
      `Delete "${goal.title}" and its key results. Attached tasks are kept.`,
    );
    if (!confirmed) {
      return;
    }
    run(async () => {
      await deleteGoal(goal.id);
      await load();
    });
  }

  function handleAbandon(goal: Goal): void {
    run(async () => {
      await updateGoal(goal.id, { status: "abandoned" });
      await load();
    });
  }

  function handleRetro(goal: Goal, retro: string): void {
    run(async () => {
      await updateGoal(goal.id, { retro: retro === "" ? null : retro });
      await load();
    });
  }

  function renderGoal(goal: Goal): JSX.Element {
    if (editor?.mode === "edit" && editor.goalId === goal.id) {
      return (
        <li key={goal.id} className="goal-editing">
          <GoalForm
            initial={valuesOf(goal)}
            onSubmit={(values) => handleEdit(goal, values)}
            onCancel={() => setEditor(null)}
          />
        </li>
      );
    }
    return (
      <GoalCard
        key={goal.id}
        goal={goal}
        habits={habits}
        onCreateKeyResult={(values) => handleCreateKeyResult(goal, values)}
        onUpdateKeyResult={(keyResultId, patch) => handleUpdateKeyResult(goal, keyResultId, patch)}
        onMoveKeyResult={(keyResultId, direction) =>
          handleMoveKeyResult(goal, keyResultId, direction)
        }
        onDeleteKeyResult={(keyResultId) => handleDeleteKeyResult(goal, keyResultId)}
        onRetro={(retro) => handleRetro(goal, retro)}
        onToggleFocus={() => handleToggleFocus(goal)}
        onAbandon={() => handleAbandon(goal)}
        onEdit={() => setEditor({ mode: "edit", goalId: goal.id })}
        onDelete={() => handleDelete(goal)}
      />
    );
  }

  const active = goals.filter((g) => g.status === "active");
  const closed = goals.filter((g) => g.status === "closed");
  const abandoned = goals.filter((g) => g.status === "abandoned");
  const activeByWindow = groupByWindow(active);

  return (
    <div className="goals-view">
      {error !== null && (
        <p className="goals-error" role="alert">
          {error}
        </p>
      )}
      {/* Gate on `loaded`, not on the array: an unloaded view is not an empty
       * one, and flashing "add your first goal" at someone who has twelve is
       * a lie the fetch corrects a moment later. */}
      {loaded && goals.length === 0 && editor === null ? (
        <p className="goals-empty-hint">
          A Goal is a durable outcome with a window — add one to start tracking it.
        </p>
      ) : (
        <>
          {activeByWindow.map(([window, windowGoals]) => (
            <section key={window} aria-label={window}>
              {activeByWindow.length > 1 && <h4>{window}</h4>}
              <ul className="goals-list" aria-label="Goals">
                {windowGoals.map((goal) => renderGoal(goal))}
              </ul>
            </section>
          ))}
          {closed.length > 0 && (
            <section>
              <h4>Closed</h4>
              <ul className="goals-list" aria-label="Closed goals">
                {closed.map((goal) => renderGoal(goal))}
              </ul>
            </section>
          )}
          {abandoned.length > 0 && (
            <section>
              <h4>Abandoned</h4>
              <ul className="goals-list" aria-label="Abandoned goals">
                {abandoned.map((goal) => renderGoal(goal))}
              </ul>
            </section>
          )}
        </>
      )}
      {editor?.mode === "create" ? (
        <GoalForm onSubmit={(values) => handleCreate(values)} onCancel={() => setEditor(null)} />
      ) : (
        <button type="button" className="goals-add" onClick={() => setEditor({ mode: "create" })}>
          <Icon name="plus" size={16} />
          Add Goal
        </button>
      )}
    </div>
  );
}
