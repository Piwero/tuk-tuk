import { useRef, useState, type KeyboardEvent } from "react";

import { updateTask, type Task } from "../api";
import { customOffset, reminderLabel, REMINDER_PRESETS, type OffsetUnit } from "../reminders";
import { IconButton } from "./IconButton";
import { Popover } from "./Popover";

interface ReminderRowProps {
  task: Task;
  onTaskChanged: (task: Task) => void;
}

/** Task detail's Reminder row (#453): chips with remove, and an add control
 * offering the presets and a custom offset. Reminders are relative to the
 * Task's date, so a dateless Task explains that instead. */
export function ReminderRow({ task, onTaskChanged }: ReminderRowProps): JSX.Element {
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState<{ amount: string; unit: OffsetUnit } | null>(null);

  function close(): void {
    setOpen(false);
    setCustom(null);
  }

  async function save(reminders: string[]): Promise<void> {
    onTaskChanged(await updateTask(task.id, { reminders }));
  }

  function add(offset: string): void {
    close();
    if (!task.reminders.includes(offset)) void save([...task.reminders, offset]);
  }

  function addCustom(): void {
    if (custom === null) return;
    const amount = Number(custom.amount);
    if (Number.isInteger(amount) && amount >= 0) add(customOffset(amount, custom.unit));
  }

  function onMenuKey(event: KeyboardEvent<HTMLUListElement>): void {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=menuitem]"),
    );
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    items[(index + step + items.length) % items.length]?.focus();
  }

  return (
    <div className="property-row reminder-row">
      <span className="property-row-label">Reminders</span>
      {task.due_date === null ? (
        <span className="reminder-row-empty">Set a date to add Reminders.</span>
      ) : (
        <span className="reminder-row-value" ref={anchor}>
          {task.reminders.length > 0 && (
            <ul aria-label="Reminders" className="reminder-chips">
              {task.reminders.map((offset) => (
                <li key={offset} className="reminder-chip">
                  {reminderLabel(offset)}
                  <IconButton
                    icon="x"
                    size={12}
                    label={`Remove reminder ${reminderLabel(offset)}`}
                    onClick={() => void save(task.reminders.filter((r) => r !== offset))}
                  />
                </li>
              ))}
            </ul>
          )}
          <IconButton
            icon="plus"
            className="reminder-add"
            label="Add reminder"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => (open ? close() : setOpen(true))}
          />
          <Popover open={open} triggerRef={anchor} onClose={close}>
            {custom === null ? (
              <ul
                role="menu"
                aria-label="Add reminder"
                className="property-options"
                onKeyDown={onMenuKey}
              >
                {REMINDER_PRESETS.map((preset) => (
                  <li role="none" key={preset.offset}>
                    <button
                      type="button"
                      role="menuitem"
                      className="property-option"
                      onClick={() => add(preset.offset)}
                    >
                      {preset.label}
                    </button>
                  </li>
                ))}
                <li role="none">
                  <button
                    type="button"
                    role="menuitem"
                    className="property-option"
                    onClick={() => setCustom({ amount: "1", unit: "hours" })}
                  >
                    Custom…
                  </button>
                </li>
              </ul>
            ) : (
              <form
                className="reminder-custom"
                aria-label="Custom reminder"
                onSubmit={(event) => {
                  event.preventDefault();
                  addCustom();
                }}
              >
                <input
                  type="number"
                  min={0}
                  aria-label="Offset amount"
                  value={custom.amount}
                  onChange={(event) => setCustom({ ...custom, amount: event.target.value })}
                />
                <select
                  aria-label="Offset unit"
                  value={custom.unit}
                  onChange={(event) =>
                    setCustom({ ...custom, unit: event.target.value as OffsetUnit })
                  }
                >
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                </select>
                <span>before</span>
                <button className="btn-primary" type="submit">
                  Add
                </button>
              </form>
            )}
          </Popover>
        </span>
      )}
    </div>
  );
}
