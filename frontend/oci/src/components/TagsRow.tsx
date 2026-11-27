import "./TagsRow.css";
import { useId, useState, type KeyboardEvent } from "react";

import { createTag, updateTask, type Tag, type Task } from "../api";
import { suggestTags } from "../tagSuggest";

import { PropertyRow } from "./PropertyRow";

interface TagsRowProps {
  task: Task;
  allTags: Tag[];
  onTaskChanged: (task: Task) => void;
  onTagCreated: (tag: Tag) => void;
}

type Choice = { kind: "tag"; tag: Tag } | { kind: "create"; name: string };

/** The Task's Tags as chips; the popover adds one by prefix (the Quick-Add
 * `#` suggestion logic), offers to create a missing Tag, and a chip's
 * remove control untags the Task. */
export function TagsRow({
  task,
  allTags,
  onTaskChanged,
  onTagCreated,
}: TagsRowProps): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const id = useId();

  const assigned = new Set(task.tags.map((tag) => tag.id));
  // Reuse the Quick-Add matcher by feeding it the query as a `#` token.
  const suggestion = suggestTags(`#${query}`, query.length + 1, allTags);
  const choices: Choice[] = [
    ...(suggestion?.options ?? [])
      .filter((tag) => !assigned.has(tag.id))
      .map((tag): Choice => ({ kind: "tag", tag })),
    ...(suggestion?.create != null
      ? [{ kind: "create", name: suggestion.create.trim() } as Choice]
      : []),
  ].filter((choice) => choice.kind === "tag" || choice.name !== "");
  const activeIndex = Math.min(active, choices.length - 1);

  async function saveTagIds(tagIds: number[]): Promise<void> {
    onTaskChanged(await updateTask(task.id, { tag_ids: tagIds }));
  }

  async function pick(choice: Choice): Promise<void> {
    setQuery("");
    setActive(0);
    let tag: Tag;
    if (choice.kind === "create") {
      tag = await createTag({ name: choice.name });
      onTagCreated(tag);
    } else {
      tag = choice.tag;
    }
    await saveTagIds([...task.tags.map((t) => t.id), tag.id]);
  }

  function remove(tag: Tag): void {
    void saveTagIds(task.tags.filter((t) => t.id !== tag.id).map((t) => t.id));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (choices.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((activeIndex + 1) % choices.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((activeIndex - 1 + choices.length) % choices.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const choice = choices[activeIndex];
      if (choice !== undefined) void pick(choice);
    }
  }

  const chips = (removable: boolean): React.JSX.Element => (
    <span className="tags-row-chips">
      {task.tags.map((tag) => (
        <span key={tag.id} className="tags-row-chip">
          {tag.name}
          {removable && (
            <button
              type="button"
              className="tags-row-chip-remove"
              aria-label={`Remove tag ${tag.name}`}
              onClick={() => remove(tag)}
            >
              ×
            </button>
          )}
        </span>
      ))}
    </span>
  );

  return (
    <PropertyRow
      label="Tags"
      quiet={task.tags.length === 0}
      value={task.tags.length === 0 ? "No tags" : chips(false)}
      onClose={() => setQuery("")}
    >
      {() => (
        <>
          {task.tags.length > 0 && chips(true)}
          <input
            type="text"
            role="combobox"
            aria-label="Add a tag"
            aria-expanded={choices.length > 0}
            aria-controls={`${id}-listbox`}
            aria-activedescendant={choices.length > 0 ? `${id}-option-${activeIndex}` : undefined}
            aria-autocomplete="list"
            placeholder="Add a tag…"
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          {choices.length > 0 && (
            <ul
              role="listbox"
              id={`${id}-listbox`}
              aria-label="Tag suggestions"
              className="property-options"
            >
              {choices.map((choice, index) => (
                <li
                  key={choice.kind === "tag" ? choice.tag.id : "create"}
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  className="property-option"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void pick(choice)}
                >
                  {choice.kind === "tag" ? choice.tag.name : `Create “${choice.name}”`}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </PropertyRow>
  );
}
