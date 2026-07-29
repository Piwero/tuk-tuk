import { useEffect, useId, useRef, useState } from "react";

import { createTag, type Tag } from "../api";
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
  /** Notified after the dropdown's "Create tag" row creates a tag, so the
   * app-wide tag list picks it up immediately — same callback Quick-Add's
   * submit-time silent create already reports through. */
  onTagCreated: (tag: Tag) => void;
}

/** A row the dropdown can show: an existing tag, or the trailing offer to
 * create one named after the query. */
type Row = { kind: "tag"; tag: Tag } | { kind: "create"; name: string };

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
  onTagCreated,
}: TokenInputProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [caret, setCaret] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const listboxId = useId();
  // Read inside the async pick() below, after its createTag() await — refs
  // (unlike the closed-over value/chips params) always hold what's current,
  // so a chip added or removed while that request is in flight isn't clobbered.
  const chipsRef = useRef(chips);
  chipsRef.current = chips;
  // Blocks a second createTag() for the same row while one is still in
  // flight — a double-click or an Enter repeat before the first resolves
  // would otherwise create two tags for one pick.
  const creating = useRef(false);

  useEffect(() => {
    if (pendingCaret.current !== null && inputRef.current !== null) {
      inputRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [value]);

  const suggestion = suggestTags(value, caret, tags);
  const rows: Row[] =
    suggestion === null
      ? []
      : [
          ...suggestion.options.map((tag): Row => ({ kind: "tag", tag })),
          ...(suggestion.create === null
            ? []
            : [{ kind: "create", name: suggestion.create } as const]),
        ];
  // A query with nothing to pick from — no matching tags, no create offer —
  // leaves the popup closed rather than render an empty listbox.
  const open = suggestion !== null && rows.length > 0;

  /** Reads the caret from the DOM — the source of truth for where the user's
   * typing cursor sits, which a controlled `value` alone doesn't capture. */
  function syncCaret(): void {
    setCaret(inputRef.current?.selectionStart ?? 0);
    setActiveIndex(null);
  }

  async function pick(row: Row): Promise<void> {
    if (suggestion === null || (row.kind === "create" && creating.current)) {
      return;
    }
    const valueAtPick = value;
    let tag: Tag;
    if (row.kind === "tag") {
      tag = row.tag;
    } else {
      creating.current = true;
      try {
        tag = await createTag({ name: row.name });
      } finally {
        creating.current = false;
      }
      onTagCreated(tag);
    }
    // The text splice only makes sense against the text it was computed
    // from — if the user kept typing while createTag() was in flight, leave
    // the (now-stale) sigil/query text alone rather than corrupt it.
    if (value === valueAtPick) {
      const result = applyTagPick(value, suggestion, tag);
      pendingCaret.current = result.caret;
      setCaret(result.caret);
      onValueChange(result.text);
    }
    if (!chipsRef.current.some((chip) => chip.id === tag.id)) {
      onChipsChange([...chipsRef.current, tag]);
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
      setActiveIndex((current) => (current === null ? 0 : Math.min(current + 1, rows.length - 1)));
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
      const picked = rows[activeIndex];
      if (picked !== undefined) {
        void pick(picked);
      }
      return;
    }
    if (event.key === "Tab") {
      // Tab completes an existing match, same as before the create row
      // existed — it's a text-completion shortcut, not a deliberate pick, so
      // it never creates a tag as a side effect.
      const first = rows.find((row) => row.kind === "tag");
      if (first !== undefined) {
        event.preventDefault();
        void pick(first);
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
          {rows.map((row, index) => (
            <li
              key={row.kind === "tag" ? row.tag.id : `create:${row.name}`}
              id={`${listboxId}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? "active" : undefined}
              onMouseDown={(event) => {
                event.preventDefault();
                void pick(row);
              }}
            >
              {row.kind === "tag" ? row.tag.name : `Create tag "${row.name}"`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
