import { useEffect, useId, useRef, useState } from "react";

import { Icon } from "./Icon";

/** One sigil's slice of the input: what it suggests from, how picks are
 * committed to chips, and (optionally) how an unmatched query creates a new
 * item. `TokenInput` treats every channel identically — the mechanism `#tag`
 * established, that `~list` and `!priority` reuse without duplicating the
 * caret/keyboard plumbing. */
export interface TokenChannel<T> {
  /** The trigger character, e.g. `#`, `~`, `!`. Must be unique per input. */
  sigil: string;
  /** "multi": picks accumulate as chips (tags). "single": a pick replaces
   * any existing chip for this channel (list, priority). */
  mode: "multi" | "single";
  chips: T[];
  onChipsChange: (chips: T[]) => void;
  getId: (item: T) => string | number;
  getLabel: (item: T) => string;
  /** Pure suggestion lookup for this sigil, e.g. `suggestTags`. Returns null
   * when the caret isn't inside this sigil's token. */
  suggest: (
    text: string,
    caret: number,
  ) => { start: number; query: string; options: T[]; create: string | null } | null;
  /** Pure text-splice for a pick, e.g. `applyTagPick`. */
  applyPick: (
    text: string,
    suggestion: { start: number; query: string },
    item: T,
  ) => { text: string; caret: number };
  /** Whether a query with no exact match offers a "Create …" row. The set
   * of Priority levels is closed, so its channel always sets this false. */
  allowCreate: boolean;
  onCreate?: (name: string) => Promise<T>;
  /** Notified after `onCreate` resolves, so app-wide state (the sidebar's
   * list of Lists or Tags) picks up the new item immediately. */
  onCreated?: (item: T) => void;
  createLabel: (name: string) => string;
  removeAriaLabel: (item: T) => string;
}

interface TokenInputProps {
  ariaLabel: string;
  placeholder?: string;
  /** The raw text, tokens (`#tag`) and all — chips are tracked separately. */
  value: string;
  onValueChange: (value: string) => void;
  channels: TokenChannel<unknown>[];
}

/** A row the dropdown can show: an existing item, or the trailing offer to
 * create one named after the query. */
type Row = { kind: "item"; item: unknown } | { kind: "create"; name: string };

/** A one-line text input that also owns a row of removable chips and a
 * sigil-triggered suggestion dropdown, generalized over any number of
 * `TokenChannel`s. Picking a suggestion strips its `<sigil>query` text and
 * adds (or, for a single-valued channel, replaces) a chip instead; raw
 * tokens left untouched still parse at submit time, same as before this
 * existed. */
export function TokenInput({
  ariaLabel,
  placeholder,
  value,
  onValueChange,
  channels,
}: TokenInputProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [caret, setCaret] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const listboxId = useId();
  // Read inside the async pick() below, after its onCreate() await — refs
  // (unlike the closed-over channels param) always hold what's current, so
  // a chip added or removed while that request is in flight isn't clobbered.
  const channelsRef = useRef(channels);
  channelsRef.current = channels;
  // Blocks a second onCreate() for the same row while one is still in
  // flight — a double-click or an Enter repeat before the first resolves
  // would otherwise create two items for one pick.
  const creating = useRef(false);

  useEffect(() => {
    if (pendingCaret.current !== null && inputRef.current !== null) {
      inputRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [value]);

  // At most one channel's sigil can own the word the caret sits in, so the
  // first match (if any) is the only active one.
  let active: {
    channel: TokenChannel<unknown>;
    suggestion: NonNullable<ReturnType<TokenChannel<unknown>["suggest"]>>;
  } | null = null;
  for (const channel of channels) {
    const suggestion = channel.suggest(value, caret);
    if (suggestion !== null) {
      active = { channel, suggestion };
      break;
    }
  }

  const rows: Row[] =
    active === null
      ? []
      : [
          ...active.suggestion.options.map((item): Row => ({ kind: "item", item })),
          ...(active.channel.allowCreate && active.suggestion.create !== null
            ? [{ kind: "create", name: active.suggestion.create } as const]
            : []),
        ];
  // A query with nothing to pick from — no matching items, no create offer —
  // leaves the popup closed rather than render an empty listbox.
  const open = active !== null && rows.length > 0;

  /** Reads the caret from the DOM — the source of truth for where the user's
   * typing cursor sits, which a controlled `value` alone doesn't capture. */
  function syncCaret(): void {
    setCaret(inputRef.current?.selectionStart ?? 0);
    setActiveIndex(null);
  }

  async function pick(row: Row): Promise<void> {
    if (active === null || (row.kind === "create" && creating.current)) {
      return;
    }
    const { channel, suggestion } = active;
    const valueAtPick = value;
    let item: unknown;
    if (row.kind === "item") {
      item = row.item;
    } else {
      if (channel.onCreate === undefined) {
        return;
      }
      creating.current = true;
      try {
        item = await channel.onCreate(row.name);
      } finally {
        creating.current = false;
      }
      channel.onCreated?.(item);
    }
    // The text splice only makes sense against the text it was computed
    // from — if the user kept typing while onCreate() was in flight, leave
    // the (now-stale) sigil/query text alone rather than corrupt it.
    if (value === valueAtPick) {
      const result = channel.applyPick(value, suggestion, item);
      pendingCaret.current = result.caret;
      setCaret(result.caret);
      onValueChange(result.text);
    }
    const fresh = channelsRef.current.find((c) => c.sigil === channel.sigil) ?? channel;
    if (fresh.mode === "single") {
      fresh.onChipsChange([item]);
    } else if (!fresh.chips.some((chip) => fresh.getId(chip) === fresh.getId(item))) {
      fresh.onChipsChange([...fresh.chips, item]);
    }
    setActiveIndex(null);
  }

  function removeChip(channel: TokenChannel<unknown>, item: unknown): void {
    channel.onChipsChange(
      channel.chips.filter((chip) => channel.getId(chip) !== channel.getId(item)),
    );
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (!open || active === null) {
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
      // it never creates an item as a side effect.
      const first = rows.find((row) => row.kind === "item");
      if (first !== undefined) {
        event.preventDefault();
        void pick(first);
      }
    }
  }

  return (
    <div className="token-input">
      {channels.some((channel) => channel.chips.length > 0) && (
        <div className="token-input-chips">
          {channels.flatMap((channel) =>
            channel.chips.map((item) => (
              <span className="tag-chip token-chip" key={`${channel.sigil}:${channel.getId(item)}`}>
                {channel.getLabel(item)}
                <button
                  type="button"
                  aria-label={channel.removeAriaLabel(item)}
                  onClick={() => removeChip(channel, item)}
                >
                  <Icon name="x" size={12} />
                </button>
              </span>
            )),
          )}
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
      {open && active !== null && (
        <ul className="token-input-dropdown" role="listbox" id={listboxId}>
          {rows.map((row, index) => (
            <li
              key={row.kind === "item" ? active.channel.getId(row.item) : `create:${row.name}`}
              id={`${listboxId}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? "active" : undefined}
              onMouseDown={(event) => {
                event.preventDefault();
                void pick(row);
              }}
            >
              {row.kind === "item"
                ? active.channel.getLabel(row.item)
                : active.channel.createLabel(row.name)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
