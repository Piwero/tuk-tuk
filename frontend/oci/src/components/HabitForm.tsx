import { useState } from "react";

import { type Habit, type HabitType } from "../api";
import { HABIT_ICON_GROUPS } from "../habitIcons";
import {
  parseHabitFrequency,
  serializeHabitFrequency,
  type HabitFrequency,
} from "../habitFrequency";
import { WEEKDAY_LABELS, WEEKDAYS, type Weekday } from "../recurrence";
import { ACCENT_PALETTE } from "../theme";
import { Icon } from "./Icon";
import { IconPicker } from "./IconPicker";

export interface HabitFormValues {
  name: string;
  type: HabitType;
  goal: number;
  step: number;
  unit: string;
  icon: string;
  color: string;
  encouragement: string;
  frequency: string;
}

export interface HabitFormProps {
  initial?: Habit;
  onSubmit: (values: HabitFormValues) => void;
  onCancel: () => void;
}

/** Draft state of the frequency editor. */
interface FrequencyDraft {
  kind: HabitFrequency["kind"];
  byday: Weekday[];
  times: string;
}

function frequencyDraftFrom(rule: string | undefined): FrequencyDraft {
  const parsed = rule === undefined ? null : parseHabitFrequency(rule);
  return {
    kind: parsed?.kind ?? "daily",
    byday: parsed?.kind === "weekdays" ? parsed.byday : [],
    times: parsed?.kind === "timesPerWeek" ? String(parsed.times) : "3",
  };
}

export function HabitForm({ initial, onSubmit, onCancel }: HabitFormProps): JSX.Element {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<HabitType>(initial?.type ?? "boolean");
  const [goal, setGoal] = useState(String(initial?.goal ?? 1));
  const [step, setStep] = useState(String(initial?.step ?? 1));
  const [unit, setUnit] = useState(initial?.unit ?? "");
  const [icon, setIcon] = useState(initial?.icon ?? "");
  const [color, setColor] = useState(initial?.color ?? "");
  const [encouragement, setEncouragement] = useState(initial?.encouragement ?? "");
  const [pickingIcon, setPickingIcon] = useState(false);
  const [frequency, setFrequency] = useState<FrequencyDraft>(
    frequencyDraftFrom(initial?.frequency),
  );

  function toggleWeekday(day: Weekday): void {
    const byday = frequency.byday.includes(day)
      ? frequency.byday.filter((existing) => existing !== day)
      : WEEKDAYS.filter((candidate) => candidate === day || frequency.byday.includes(candidate));
    setFrequency({ ...frequency, byday });
  }

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    const trimmed = name.trim();
    const goalNumber = Number(goal);
    const stepNumber = Number(step);
    const times = Number(frequency.times);
    if (trimmed === "") {
      return;
    }
    if (type === "numeric" && (!(goalNumber > 0) || !(stepNumber > 0))) {
      return;
    }
    if (frequency.kind === "weekdays" && frequency.byday.length === 0) {
      return;
    }
    if (frequency.kind === "timesPerWeek" && (!Number.isInteger(times) || times < 1 || times > 7)) {
      return;
    }
    onSubmit({
      name: trimmed,
      type,
      goal: goalNumber,
      step: stepNumber,
      unit: unit.trim(),
      icon: icon.trim(),
      color: color.trim(),
      encouragement: encouragement.trim(),
      frequency: serializeHabitFrequency(
        frequency.kind === "daily"
          ? { kind: "daily" }
          : frequency.kind === "weekdays"
            ? { kind: "weekdays", byday: frequency.byday }
            : { kind: "timesPerWeek", times },
      ),
    });
  }

  return (
    <form className="habit-form" onSubmit={handleSubmit}>
      <label>
        Name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        Type
        <select
          aria-label="Habit type"
          value={type}
          onChange={(event) => setType(event.target.value as HabitType)}
        >
          <option value="boolean">Boolean</option>
          <option value="numeric">Numeric</option>
        </select>
      </label>
      {type === "numeric" && (
        <>
          <label>
            Goal
            <input
              type="number"
              min={0}
              step="any"
              aria-label="Goal"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
            />
          </label>
          <label>
            Step
            <input
              type="number"
              min={0}
              step="any"
              aria-label="Step"
              value={step}
              onChange={(event) => setStep(event.target.value)}
            />
          </label>
          <label>
            Unit
            <input
              aria-label="Unit"
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
            />
          </label>
        </>
      )}
      <label>
        Icon
        <button
          type="button"
          className="icon-field"
          aria-label="Icon"
          onClick={() => setPickingIcon(true)}
        >
          {icon === "" ? <Icon name="smile" /> : icon}
        </button>
      </label>
      {pickingIcon && (
        <IconPicker
          title="Choose an icon"
          groups={HABIT_ICON_GROUPS}
          clearLabel="No icon"
          onSelect={(emoji) => {
            setIcon(emoji);
            setPickingIcon(false);
          }}
          onClose={() => setPickingIcon(false)}
        />
      )}
      <fieldset className="color-palette">
        <legend>Color</legend>
        <label className="color-swatch none">
          <input
            type="radio"
            name="habit-color"
            aria-label="No colour"
            checked={color === ""}
            value=""
            onChange={() => setColor("")}
          />
        </label>
        {ACCENT_PALETTE.map((swatch) => (
          <label key={swatch.value} className="color-swatch" style={{ background: swatch.value }}>
            <input
              type="radio"
              name="habit-color"
              aria-label={swatch.name}
              checked={color === swatch.value}
              value={swatch.value}
              onChange={() => setColor(swatch.value)}
            />
          </label>
        ))}
      </fieldset>
      <label>
        Encouragement
        <input
          aria-label="Encouragement"
          value={encouragement}
          onChange={(event) => setEncouragement(event.target.value)}
        />
      </label>
      <label>
        Frequency
        <select
          aria-label="Frequency"
          value={frequency.kind}
          onChange={(event) =>
            setFrequency({ ...frequency, kind: event.target.value as FrequencyDraft["kind"] })
          }
        >
          <option value="daily">Every day</option>
          <option value="weekdays">On weekdays</option>
          <option value="timesPerWeek">Times per week</option>
        </select>
      </label>
      {frequency.kind === "weekdays" && (
        <div className="habit-weekdays">
          {WEEKDAYS.map((day) => (
            <label key={day}>
              <input
                type="checkbox"
                aria-label={`Repeat on ${WEEKDAY_LABELS[day]}`}
                checked={frequency.byday.includes(day)}
                onChange={() => toggleWeekday(day)}
              />
              {WEEKDAY_LABELS[day]}
            </label>
          ))}
        </div>
      )}
      {frequency.kind === "timesPerWeek" && (
        <label>
          Times a week
          <input
            type="number"
            min={1}
            max={7}
            aria-label="Times a week"
            value={frequency.times}
            onChange={(event) => setFrequency({ ...frequency, times: event.target.value })}
          />
        </label>
      )}
      <button type="submit">Save</button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
