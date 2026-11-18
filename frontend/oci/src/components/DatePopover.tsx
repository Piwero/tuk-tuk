import "./DatePopover.css";

import { useId, useRef, useState, type KeyboardEvent } from "react";

import { addDays, fromDayIso, localDayOf, nextMonday } from "../dates";
import { Popover } from "./Popover";

interface DatePopoverProps {
  /** Accessible name of the trigger, e.g. "Stand-up date". */
  label: string;
  /** YYYY-MM-DD, or "" for no date. */
  value: string;
  onChange: (day: string) => void;
  /** Shows a Clear button; called with "" semantics via onChange("") . */
  clearable?: boolean;
  /** Optional time of day (HH:MM); the field shows only when onTimeChange is given. */
  time?: string;
  onTimeChange?: (time: string) => void;
  className?: string;
  id?: string;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const monthFormat = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const dayFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});
const triggerFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

function addMonths(day: string, months: number): string {
  const date = fromDayIso(monthStart(day));
  date.setMonth(date.getMonth() + months);
  return localDayOf(date);
}

/** The 6-week grid (Monday first) covering the month of `day`. */
function gridDays(day: string): string[] {
  const first = monthStart(day);
  const offset = (fromDayIso(first).getDay() + 6) % 7;
  const start = addDays(first, -offset);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** One date picker: a trigger button opening a calendar on the Popover. */
export function DatePopover({
  label,
  value,
  onChange,
  clearable = false,
  time,
  onTimeChange,
  className,
  id,
}: DatePopoverProps): JSX.Element {
  const trigger = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const today = localDayOf(new Date());
  const [focused, setFocused] = useState(value === "" ? today : value);
  const titleId = useId();

  function show(): void {
    setFocused(value === "" ? today : value);
    setOpen(true);
  }

  function pick(day: string): void {
    onChange(day);
    setOpen(false);
  }

  function moveTo(day: string): void {
    setFocused(day);
    requestAnimationFrame(() =>
      grid.current?.querySelector<HTMLElement>(`[data-day="${day}"]`)?.focus(),
    );
  }

  function onGridKey(event: KeyboardEvent): void {
    const steps: Record<string, string> = {
      ArrowLeft: addDays(focused, -1),
      ArrowRight: addDays(focused, 1),
      ArrowUp: addDays(focused, -7),
      ArrowDown: addDays(focused, 7),
      PageUp: addMonths(focused, -1),
      PageDown: addMonths(focused, 1),
      Home: addDays(focused, -((fromDayIso(focused).getDay() + 6) % 7)),
      End: addDays(focused, 6 - ((fromDayIso(focused).getDay() + 6) % 7)),
    };
    const next = steps[event.key];
    if (next === undefined) return;
    event.preventDefault();
    moveTo(next);
  }

  const days = gridDays(focused);
  const month = focused.slice(0, 7);
  const quick: Array<[string, string]> = [
    ["Today", today],
    ["Tomorrow", addDays(today, 1)],
    ["Next Monday", nextMonday(today)],
  ];

  return (
    <span className={`date-popover ${className ?? ""}`.trim()}>
      <button
        type="button"
        id={id}
        ref={trigger}
        className="date-popover-trigger btn-secondary"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        onClick={() => (open ? setOpen(false) : show())}
      >
        {value === "" ? "No date" : triggerFormat.format(fromDayIso(value))}
      </button>
      <Popover open={open} triggerRef={trigger} onClose={() => setOpen(false)}>
        <div className="date-popover-panel" role="dialog" aria-label={`Choose ${label}`}>
          <div className="date-popover-quick">
            {quick.map(([name, day]) => (
              <button type="button" className="btn-quiet" key={name} onClick={() => pick(day)}>
                {name}
              </button>
            ))}
            {clearable && (
              <button type="button" className="btn-quiet" onClick={() => pick("")}>
                Clear
              </button>
            )}
          </div>
          <div className="date-popover-nav">
            <button
              type="button"
              className="btn-quiet"
              aria-label="Previous month"
              onClick={() => moveTo(addMonths(focused, -1))}
            >
              ‹
            </button>
            <span id={titleId} aria-live="polite">
              {monthFormat.format(fromDayIso(focused))}
            </span>
            <button
              type="button"
              className="btn-quiet"
              aria-label="Next month"
              onClick={() => moveTo(addMonths(focused, 1))}
            >
              ›
            </button>
          </div>
          <div role="grid" aria-labelledby={titleId} ref={grid} onKeyDown={onGridKey}>
            <div role="row" className="date-popover-row">
              {WEEKDAYS.map((name) => (
                <span role="columnheader" key={name}>
                  {name}
                </span>
              ))}
            </div>
            {Array.from({ length: 6 }, (_, week) => (
              <div role="row" className="date-popover-row" key={week}>
                {days.slice(week * 7, week * 7 + 7).map((day) => (
                  <span role="gridcell" key={day} aria-selected={day === value}>
                    <button
                      type="button"
                      data-day={day}
                      tabIndex={day === focused ? 0 : -1}
                      aria-label={dayFormat.format(fromDayIso(day))}
                      aria-current={day === today ? "date" : undefined}
                      className={`date-popover-day${day.slice(0, 7) === month ? "" : " outside"}${day === value ? " selected" : ""}`}
                      onClick={() => pick(day)}
                    >
                      {Number(day.slice(8))}
                    </button>
                  </span>
                ))}
              </div>
            ))}
          </div>
          {onTimeChange !== undefined && (
            <label className="date-popover-time">
              Time
              <input
                type="time"
                value={time ?? ""}
                onChange={(event) => onTimeChange(event.target.value)}
              />
            </label>
          )}
        </div>
      </Popover>
    </span>
  );
}
