import { useEffect, useMemo, useRef, useState } from "react";

import { flattenGroups, groupItems, type PaletteItem } from "../commandPalette";

interface CommandPaletteProps {
  /** Every jump target the palette offers, already wired to navigate. */
  items: PaletteItem[];
  /** Closes the palette. Focus is restored to the opener here in this
   * component, so callers only have to flip their "open" flag. */
  onClose: () => void;
}

/** The one overlay opened with cmd/ctrl+K (issue #201). Searches Lists,
 * Folders, Tags, Smart Lists, feature views and open Tasks and navigates to
 * the pick — it carries only the shell: open, filter, group, keyboard
 * traversal, focus trap, and it is announced as a dialog.
 *
 * Arrow keys move a single highlight through every matched item (grouped by
 * kind), Enter runs the highlighted one, Escape closes and restores focus to
 * whatever held it when the palette opened. Tab is trapped: the query field
 * is the only tab stop, and every result is still reachable by arrowing. */
export function CommandPalette({ items, onClose }: CommandPaletteProps): JSX.Element {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // The last moment the opener still holds focus (see Modal.tsx for the same
  // trick) — restored when the palette unmounts.
  const [opener] = useState(() => document.activeElement as HTMLElement | null);

  const groups = useMemo(() => groupItems(items, query), [items, query]);
  const flat = useMemo(() => flattenGroups(groups), [groups]);

  // A narrowing query can leave the highlight past the end of the list.
  useEffect(() => {
    setActive((current) => (current >= flat.length ? 0 : current));
  }, [flat.length]);

  useEffect(() => {
    inputRef.current?.focus();
    return () => opener?.focus();
  }, [opener]);

  function choose(item: PaletteItem | undefined): void {
    if (item === undefined) {
      return;
    }
    item.run();
    onClose();
  }

  function handleKeyDown(event: React.KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "Tab") {
      // Only the field is a tab stop — nothing to cycle to, so the trap is
      // just "focus never leaves".
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (flat.length === 0 ? 0 : (current + 1) % flat.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (flat.length === 0 ? 0 : (current - 1 + flat.length) % flat.length));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      choose(flat[active]);
    }
  }

  const activeId = flat[active] === undefined ? undefined : `command-palette-option-${active}`;
  let flatIndex = -1;

  return (
    <div
      className="command-palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={handleKeyDown}
      >
        <input
          ref={inputRef}
          type="text"
          className="command-palette-input"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-palette-results"
          aria-activedescendant={activeId}
          aria-label="Search lists, folders, tags and tasks"
          placeholder="Jump to a list, tag, view or task…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div id="command-palette-results" role="listbox" className="command-palette-results">
          {groups.map((group) => (
            <div key={group.kind} role="group" aria-label={group.heading}>
              <div className="command-palette-heading" aria-hidden="true">
                {group.heading}
              </div>
              {group.items.map((item) => {
                flatIndex += 1;
                const index = flatIndex;
                return (
                  <div
                    key={item.key}
                    id={`command-palette-option-${index}`}
                    role="option"
                    aria-selected={index === active}
                    className={
                      index === active ? "command-palette-option active" : "command-palette-option"
                    }
                    onMouseMove={() => setActive(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(item)}
                  >
                    {item.label}
                  </div>
                );
              })}
            </div>
          ))}
          {groups.length === 0 && <p className="command-palette-empty">No matches</p>}
        </div>
      </div>
    </div>
  );
}
