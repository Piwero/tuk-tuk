import "./PropertyRow.css";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Popover } from "./Popover";

interface PropertyRowProps {
  /** Visible label and the trigger's accessible name. */
  label: string;
  /** What the row reads as when closed. */
  value: ReactNode;
  /** Unset values read quietly (muted) rather than as a call to action. */
  quiet?: boolean;
  disabled?: boolean;
  /** Called whenever the popover closes, however it closed. */
  onClose?: () => void;
  /** Popover body; `close` dismisses it and returns focus to the row. */
  children: (close: () => void) => ReactNode;
}

/** Moves focus to the previous/next row trigger inside the same
 * `.property-rows` group, so the rows read as one keyboard-navigable list. */
function moveBetweenRows(event: KeyboardEvent<HTMLButtonElement>): void {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const group = event.currentTarget.closest(".property-rows");
  if (group === null) return;
  const triggers = Array.from(
    group.querySelectorAll<HTMLButtonElement>(".property-row-trigger:not(:disabled)"),
  );
  const index = triggers.indexOf(event.currentTarget);
  const next = triggers[index + (event.key === "ArrowDown" ? 1 : -1)];
  if (next !== undefined) {
    event.preventDefault();
    next.focus();
  }
}

/** One Task property: a label and a value that opens a Popover to edit it
 * in place. Enter/Space/click open; arrows move between rows; Escape (via
 * Popover) closes and returns focus to the row. */
export function PropertyRow({
  label,
  value,
  quiet = false,
  disabled = false,
  onClose,
  children,
}: PropertyRowProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = (): void => {
    setOpen(false);
    onClose?.();
  };
  return (
    <div className="property-row">
      <span className="property-row-label" id={`${id}-label`}>
        {label}
      </span>
      <button
        ref={trigger}
        type="button"
        className={quiet ? "property-row-trigger is-quiet" : "property-row-trigger"}
        id={`${id}-value`}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={moveBetweenRows}
      >
        {value}
      </button>
      <Popover open={open} triggerRef={trigger} onClose={close}>
        <div role="dialog" aria-label={label} className="property-row-panel">
          {children(close)}
        </div>
      </Popover>
    </div>
  );
}

export interface PropertyOption<T> {
  value: T;
  label: string;
  icon?: ReactNode;
}

interface PropertyOptionsProps<T> {
  label: string;
  options: PropertyOption<T>[];
  selected: T;
  onSelect: (value: T) => void;
}

/** A single-choice menu for a PropertyRow popover: the selected option takes
 * focus on open, arrows move, Home/End jump, Enter picks. */
export function PropertyOptions<T>({
  label,
  options,
  selected,
  onSelect,
}: PropertyOptionsProps<T>): React.JSX.Element {
  const list = useRef<HTMLUListElement>(null);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === selected),
  );

  useEffect(() => {
    const items = list.current?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]");
    items?.item(selectedIndex)?.focus();
    // Focus once on mount only; later re-renders must not yank focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>): void {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]"),
    );
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    let target: number | null = null;
    if (event.key === "ArrowDown") target = (index + 1) % items.length;
    else if (event.key === "ArrowUp") target = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = items.length - 1;
    if (target !== null) {
      event.preventDefault();
      items[target]?.focus();
    }
  }

  return (
    <ul
      role="menu"
      aria-label={label}
      className="property-options"
      ref={list}
      onKeyDown={onKeyDown}
    >
      {options.map((option, index) => (
        <li role="none" key={option.label}>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={option.value === selected}
            tabIndex={index === selectedIndex ? 0 : -1}
            className="property-option"
            onClick={() => onSelect(option.value)}
          >
            {option.icon}
            {option.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
