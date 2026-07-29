import { useEffect, useId, useRef, useState } from "react";

import { type Tag } from "../api";
import { applyTagPick, suggestTags } from "../tagSuggest";
import { Icon } from "./Icon";

interface TokenInputProps {
  ariaLabel: string;
  placeholder?: string;
  /** The raw text, tokens (`#tag`) and all — chips are tracked separately. */
  value: string;
  onValueChange: (value: string) => void;
  chips: Tag[];
  onChipsChange: (chips: Tag[]) => void;
  /** Candidates the `#` dropdown suggests from. */
  tags: Tag[];
}

/** A one-line text input that also owns a row of removable chips and a
 * `#tag`-triggered suggestion dropdown — the seam every later sigil (`~list`,
 * …) can reuse without duplicating the caret/keyboard plumbing. Picking a
 * suggestion strips its `#query` text and adds a chip instead; raw `#tokens`
 * left untouched still parse at submit time, same as before this existed. */
export function TokenInput({
  ariaLabel,
  placeholder,
  value,
  onValueChange,
  chips,
  onChipsChange,
  tags,
}: TokenInputProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [caret, setCaret] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const listboxId = useId();

  useEffect(() => {
    if (pendingCaret.current !== null && inputRef.current !== null) {
      inputRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [value]);

  const suggestion = suggestTags(value, caret, tags);
  // A query with zero matches is still "active" per suggestTags — nothing
  // to pick from yet, so the popup itself stays closed rather than render
  // an empty listbox.
  const open = suggestion !== null && suggestion.options.length > 0;

  /** Reads the caret from the DOM — the source of truth for where the user's
   * typing cursor sits, which a controlled `value` alone doesn't capture. */
  function syncCaret(): void {
    setCaret(inputRef.current?.selectionStart ?? 0);
    setActiveIndex(null);
  }

  function pick(tag: Tag): void {
    if (suggestion === null) {
      return;
    }
    const result = applyTagPick(value, suggestion, tag);
    pendingCaret.current = result.caret;
    onValueChange(result.text);
    if (!chips.some((chip) => chip.id === tag.id)) {
      onChipsChange([...chips, tag]);
    }
    setActiveIndex(null);
  }

  function removeChip(tag: Tag): void {
    onChipsChange(chips.filter((chip) => chip.id !== tag.id));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (!open || suggestion === null) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) =>
        current === null ? 0 : Math.min(current + 1, suggestion.options.length - 1),
      );
      return;
    }
    if (event.key === "ArrowUp") {
      if (activeIndex === null) {
        return;
      }
      event.preventDefault();
      setActiveIndex(activeIndex === 0 ? null : activeIndex - 1);
      return;
    }
    if (event.key === "Escape") {
      if (activeIndex !== null) {
        event.preventDefault();
        setActiveIndex(null);
      }
      return;
    }
    if (event.key === "Enter" && activeIndex !== null) {
      event.preventDefault();
      const picked = suggestion.options[activeIndex];
      if (picked !== undefined) {
        pick(picked);
      }
      return;
    }
    if (event.key === "Tab") {
      const first = suggestion.options[0];
      if (first !== undefined) {
        event.preventDefault();
        pick(first);
      }
    }
  }

  return (
    <div className="token-input">
      {chips.length > 0 && (
        <div className="token-input-chips">
          {chips.map((chip) => (
            <span className="tag-chip token-chip" key={chip.id}>
              {chip.name}
              <button
                type="button"
                aria-label={`Remove ${chip.name}`}
                onClick={() => removeChip(chip)}
              >
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={
          open && activeIndex !== null ? `${listboxId}-option-${activeIndex}` : undefined
        }
        onChange={(event) => {
          onValueChange(event.target.value);
          syncCaret();
        }}
        onClick={syncCaret}
        onKeyUp={(event) => {
          if (
            event.key === "ArrowLeft" ||
            event.key === "ArrowRight" ||
            event.key === "Home" ||
            event.key === "End"
          ) {
            syncCaret();
          }
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul className="token-input-dropdown" role="listbox" id={listboxId}>
          {suggestion.options.map((tag, index) => (
            <li
              key={tag.id}
              id={`${listboxId}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? "active" : undefined}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(tag);
              }}
            >
              {tag.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
