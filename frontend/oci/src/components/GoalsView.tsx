import { EmptyState, LoadError, SkeletonRows } from "./TaskViewState";
import "./GoalsView.css";
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
import { localDayOf } from "../dates";
import { endDrag, readDragPayload, startDrag } from "../dnd";
import { goalPace } from "../goalPace";
import { appendOrder, planInsertBefore } from "../ordering";
import { goalPaceDelta, goalPaceVerdict, goalWindowLabel, goalWindowRange } from "../goalWindow";
import { DatePopover } from "./DatePopover";
import { Hint } from "./Hint";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { type OverflowMenuItem, OverflowMenu } from "./OverflowMenu";

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
function GoalForm({ initial, onSubmit, onCancel }: GoalFormProps): React.JSX.Element {
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
        <DatePopover
          label="Start date"
          value={values.start_date}
          clearable
          onChange={(day) => set("start_date", day)}
        />
      </label>
      <label>
        End date
        <DatePopover
          label="End date"
          value={values.end_date}
          clearable
          onChange={(day) => set("end_date", day)}
        />
      </label>
      <p className="goal-form-date-hint">Blank uses the current quarter.</p>
      <div className="goal-form-actions">
        <button className="btn-primary" type="submit">
          Save
        </button>
        <button className="btn-quiet" type="button" onClick={onCancel}>
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

/** A number shown as text until clicked, then typed over in place. Blur or
 * Enter commits through one write path (issue #246); Escape abandons. */
function ClickToType({
  value,
  label,
  editing,
  onEditingChange,
  onCommit,
  children,
}: {
  value: number;
  label: string;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onCommit: (value: number) => void;
  children?: React.ReactNode;
}): React.JSX.Element {
  if (!editing) {
    return children === undefined ? (
      <></>
    ) : (
      <button
        type="button"
        className="key-result-value btn-quiet"
        aria-label={`Edit ${label}`}
        onClick={() => onEditingChange(true)}
      >
        {children}
      </button>
    );
  }
  return (
    <input
      aria-label={label}
      className="key-result-value-input"
      type="number"
      autoFocus
      defaultValue={value}
      onBlur={(event) => {
        onEditingChange(false);
        const next = Number(event.target.value);
        if (event.target.value !== "" && next !== value) {
          onCommit(next);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.currentTarget.value = String(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

/** One Key Result row, read-only at rest: name, a bar and 'current of
 * target'. A manual one adds a single stepper and a click-to-type value; an
 * automatic one names its source instead. Reorder (also by dragging the row),
 * target edits and delete live in the row's overflow menu. A "task_count" row
 * can expand to show the Tasks its count is made of, so the number can be
 * checked rather than trusted. */
function KeyResultRow({
  keyResult: kr,
  isFirst,
  isLast,
  onUpdate,
  onMove,
  onDropBefore,
  onDelete,
}: {
  keyResult: KeyResult;
  isFirst: boolean;
  isLast: boolean;
  onUpdate: (keyResultId: number, patch: KeyResultPatch) => void;
  onMove: (keyResultId: number, direction: -1 | 1) => void;
  onDropBefore: (keyResultId: number, beforeId: number) => void;
  onDelete: (keyResultId: number) => void;
}): React.JSX.Element {
  const [showTasks, setShowTasks] = useState(false);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [editingCurrent, setEditingCurrent] = useState(false);
  const [editingTarget, setEditingTarget] = useState(false);
  const percent = Math.round(kr.ratio * 100);
  const manual = kr.source === "manual";
  const amount = `${kr.current_value} of ${kr.target_value}`;

  useEffect(() => {
    if (!showTasks) {
      return;
    }
    void fetchTasksByKeyResult(kr.id).then((page) => setTasks(page.items));
  }, [showTasks, kr.id, kr.current_value]);

  return (
    <li
      className="key-result"
      draggable
      onDragStart={(event) => startDrag(event, { kind: "key-result", id: kr.id })}
      onDragEnd={endDrag}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const payload = readDragPayload(event);
        if (payload?.kind === "key-result" && payload.id !== kr.id) {
          onDropBefore(payload.id, kr.id);
        }
      }}
    >
      <div className="key-result-row">
        <span className="key-result-name">{kr.name}</span>
        <span
          className="key-result-meter"
          role="progressbar"
          aria-label={`${kr.name} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          style={{ ["--kr-fill" as string]: `${Math.min(100, percent)}%` }}
        />
        {editingTarget ? (
          <ClickToType
            value={kr.target_value}
            label={`${kr.name} target value`}
            editing
            onEditingChange={setEditingTarget}
            onCommit={(value) => onUpdate(kr.id, { target_value: value })}
          />
        ) : manual ? (
          <ClickToType
            value={kr.current_value}
            label={`${kr.name} current value`}
            editing={editingCurrent}
            onEditingChange={setEditingCurrent}
            onCommit={(value) => onUpdate(kr.id, { current_value: value })}
          >
            {amount}
          </ClickToType>
        ) : (
          <span className="key-result-readonly">{amount}</span>
        )}
        {manual ? (
          <IconButton
            icon="plus"
            size={14}
            className="key-result-step"
            label={`Add 1 to ${kr.name}`}
            onClick={() => onUpdate(kr.id, { current_value: kr.current_value + 1 })}
          />
        ) : (
          <span className="key-result-source">{SOURCE_NOTE[kr.source]}</span>
        )}
        <OverflowMenu
          label={`Actions for key result ${kr.name}`}
          items={[
            {
              text: "Move up",
              label: `Move key result ${kr.name} up`,
              icon: "chevron-up",
              disabled: isFirst,
              onSelect: () => onMove(kr.id, -1),
            },
            {
              text: "Move down",
              label: `Move key result ${kr.name} down`,
              icon: "chevron-down",
              disabled: isLast,
              onSelect: () => onMove(kr.id, 1),
            },
            {
              text: "Edit target",
              label: `Edit ${kr.name} target value`,
              icon: "pencil",
              onSelect: () => setEditingTarget(true),
            },
            {
              text: "Delete",
              label: `Delete key result ${kr.name}`,
              icon: "trash-2",
              danger: true,
              onSelect: () => onDelete(kr.id),
            },
          ]}
        />
      </div>
      {kr.source === "task_count" && (
        <>
          <button
            type="button"
            className="key-result-tasks-toggle btn-quiet"
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

/** Score on a bar; while the Goal is active a marker shows where today falls
 * in the window and a verdict states how far ahead of or behind pace it is.
 * An unmeasured Goal (no Key Results) and a settled one carry no pace (ADR 0012). */
function GoalScore({ goal }: { goal: Goal }): React.JSX.Element {
  const today = localDayOf(new Date());
  const delta =
    goal.status === "active"
      ? goalPaceDelta(goal.score, goal.start_date, goal.end_date, today)
      : null;
  const verdict = goalPaceVerdict(delta);
  return (
    <div className="goal-score-block">
      {goal.score === null ? (
        <p className="goal-score-unmeasured">No Key Results yet — unmeasured.</p>
      ) : (
        <Hint hintKey="score">
          <div className="goal-score" tabIndex={0}>
            <p>Score: {Math.round(goal.score * 100)}%</p>
            <div className="goal-score-track">
              <div
                className="goal-score-bar"
                role="progressbar"
                aria-label={`${goal.title} Score`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(goal.score * 100)}
                style={{ ["--goal-score-fill" as string]: `${Math.round(goal.score * 100)}%` }}
              />
              {delta !== null && (
                <span
                  className="goal-pace-marker"
                  aria-label={`Today's pace: ${Math.round((goalPace(goal.start_date, goal.end_date, today) ?? 0) * 100)}%`}
                  style={{
                    ["--goal-pace" as string]: `${(goalPace(goal.start_date, goal.end_date, today) ?? 0) * 100}%`,
                  }}
                />
              )}
            </div>
            {verdict !== null && <p className="goal-pace-verdict">{verdict}</p>}
          </div>
        </Hint>
      )}
    </div>
  );
}

/** A Goal's Key Results: read-only rows, an add form, and per-row actions.
 * Automatic sources (habit_checkins, task_count) never take a typed value
 * (ADR 0012) — only "manual" Key Results get the stepper and click-to-type;
 * the target is editable on every Key Result from its menu. */
function KeyResultsPanel({
  goal,
  habits,
  onCreate,
  onUpdate,
  onMove,
  onDropBefore,
  onDelete,
}: {
  goal: Goal;
  habits: Habit[];
  onCreate: (values: KeyResultFormValues) => void;
  onUpdate: (keyResultId: number, patch: KeyResultPatch) => void;
  onMove: (keyResultId: number, direction: -1 | 1) => void;
  onDropBefore: (keyResultId: number, beforeId: number) => void;
  onDelete: (keyResultId: number) => void;
}): React.JSX.Element {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<KeyResultFormValues>(BLANK_KEY_RESULT);

  function set<K extends keyof KeyResultFormValues>(key: K, value: KeyResultFormValues[K]): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="key-results" aria-label={`${goal.title} key results`}>
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
                onDropBefore={onDropBefore}
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
            <button className="btn-primary" type="submit">
              Add key result
            </button>
            <button className="btn-quiet" type="button" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button className="btn-secondary" type="button" onClick={() => setAdding(true)}>
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
    const key = goalWindowRange(goal.start_date, goal.end_date);
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

/** A Goal card. Focus/Unfocus, Abandon, Edit and Delete sit in one overflow
 * menu in the card's header (#464): reachable by keyboard and by a plain tap
 * on touch, replacing the long-press reveal (#248) — the menu itself is the
 * guard against an accidental Delete. */
function GoalCard({
  goal,
  habits,
  onCreateKeyResult,
  onUpdateKeyResult,
  onMoveKeyResult,
  onDropKeyResult,
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
  onDropKeyResult: (keyResultId: number, beforeId: number) => void;
  onDeleteKeyResult: (keyResultId: number) => void;
  onRetro: (retro: string) => void;
  onToggleFocus: () => void;
  onAbandon: () => void;
  onEdit: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  const actions: OverflowMenuItem[] = [];
  if (goal.status === "active") {
    actions.push(
      {
        text: goal.is_focused ? "Unfocus" : "Focus",
        label: goal.is_focused ? `Unfocus ${goal.title}` : `Focus ${goal.title}`,
        icon: "target",
        onSelect: onToggleFocus,
      },
      { text: "Abandon", label: `Abandon ${goal.title}`, icon: "x", onSelect: onAbandon },
    );
  }
  actions.push(
    { text: "Edit", label: `Edit ${goal.title}`, icon: "pencil", onSelect: onEdit },
    {
      text: "Delete",
      label: `Delete goal ${goal.title}`,
      icon: "trash-2",
      danger: true,
      onSelect: onDelete,
    },
  );

  return (
    <li className={goal.is_focused ? "goal goal-focused" : "goal"}>
      <div className="goal-header">
        <h3>
          {goal.title}
          {goal.is_focused && <span className="goal-focused-badge">Focused</span>}
        </h3>
        <OverflowMenu
          label={`Actions for ${goal.title}`}
          items={actions}
          className="goal-actions"
        />
      </div>
      {goal.description !== "" && <p>{goal.description}</p>}
      <p className="goal-window">
        {goalWindowLabel(goal.start_date, goal.end_date, localDayOf(new Date()))}
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
      <GoalScore goal={goal} />
      <KeyResultsPanel
        goal={goal}
        habits={habits}
        onCreate={onCreateKeyResult}
        onUpdate={onUpdateKeyResult}
        onMove={onMoveKeyResult}
        onDropBefore={onDropKeyResult}
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
    </li>
  );
}

type Editor = { mode: "create" } | { mode: "edit"; goalId: number } | null;

/** The Goals view: list, create, edit, delete, Key Results, and focus
 * (ADR 0012). Self-fetching, like the Habits and Stand-up views. */
export function GoalsView(): React.JSX.Element {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [editor, setEditor] = useState<Editor>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const page = await fetchGoals();
    setGoals(page.items);
    setLoaded(true);
    setLoadFailed(false);
  }, []);

  const firstLoad = useCallback((): void => {
    setLoadFailed(false);
    setLoaded(false);
    void load().catch(() => {
      setLoadFailed(true);
    });
  }, [load]);

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
    firstLoad();
  }, [firstLoad]);

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

  /** Moves a Key Result before another (or to the end, `beforeId` null) with
   * one sparse sort_order write, renumbering only when the gap runs out. */
  function handleDropKeyResult(goal: Goal, keyResultId: number, beforeId: number | null): void {
    const moving = goal.key_results.find((kr) => kr.id === keyResultId);
    if (moving === undefined) {
      return;
    }
    const siblings = goal.key_results.filter((kr) => kr.id !== keyResultId);
    const plan =
      beforeId === null
        ? { kind: "single" as const, sort_order: appendOrder(siblings) }
        : planInsertBefore(siblings, moving, beforeId);
    run(async () => {
      let updated: Goal | null = null;
      if (plan.kind === "single") {
        updated = await updateKeyResult(goal.id, moving.id, { sort_order: plan.sort_order });
      } else {
        for (const { row, sort_order } of plan.rows) {
          updated = await updateKeyResult(goal.id, row.id, { sort_order });
        }
      }
      const next = updated;
      if (next !== null) {
        setGoals((current) => current.map((g) => (g.id === next.id ? next : g)));
      }
    });
  }

  /** The keyboard path for the same reorder: up drops before the previous
   * row, down drops before the row after next (or at the end). */
  function handleMoveKeyResult(goal: Goal, keyResultId: number, direction: -1 | 1): void {
    const index = goal.key_results.findIndex((kr) => kr.id === keyResultId);
    if (index === -1) {
      return;
    }
    if (direction === -1) {
      const previous = goal.key_results[index - 1];
      if (previous !== undefined) {
        handleDropKeyResult(goal, keyResultId, previous.id);
      }
      return;
    }
    if (index + 1 >= goal.key_results.length) {
      return;
    }
    handleDropKeyResult(goal, keyResultId, goal.key_results[index + 2]?.id ?? null);
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

  function renderGoal(goal: Goal): React.JSX.Element {
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
        onDropKeyResult={(keyResultId, beforeId) =>
          handleDropKeyResult(goal, keyResultId, beforeId)
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

  if (loadFailed) {
    return (
      <div className="goals-view">
        <LoadError what="goals" onRetry={firstLoad} />
      </div>
    );
  }
  if (!loaded) {
    return (
      <div className="goals-view">
        <SkeletonRows label="Loading goals" />
      </div>
    );
  }

  const empty = goals.length === 0 && editor === null;

  return (
    <div className="goals-view">
      {error !== null && (
        <p className="goals-error" role="alert">
          {error}
        </p>
      )}
      {/* Only reached once loaded: an unloaded view is not an empty one. */}
      {empty ? (
        <EmptyState
          title="No goals yet"
          description="A Goal is a durable outcome with a window — add one to start tracking it."
          actionLabel="Add Goal"
          onAction={() => setEditor({ mode: "create" })}
        />
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
        !empty && (
          <button
            type="button"
            className="goals-add btn-secondary"
            onClick={() => setEditor({ mode: "create" })}
          >
            <Icon name="plus" size={16} />
            Add Goal
          </button>
        )
      )}
    </div>
  );
}
