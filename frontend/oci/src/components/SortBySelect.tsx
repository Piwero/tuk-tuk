import { useId } from "react";

import { type SortBy } from "../grouping";
import { hasReorderedTasks } from "../layoutPrefs";
import { Hint } from "./Hint";

interface SortBySelectProps {
  value: SortBy;
  onChange: (sortBy: SortBy) => void;
}

/** The "Sort by" control, shared by every view that offers the full set of
 * sorts (issue #279's All view and the plain List view). One component so
 * the option wording, the "Custom" explanation and the hint treatment can't
 * drift apart between the two places they appear.
 *
 * The "Custom" option reads plainly (#280): whether the user has arranged
 * tasks yet is stated once, in the helper line beside the control, rather
 * than hidden inside the option's own label in different words. The helper
 * below (issue #260) is that single place — the underlying order always
 * exists, so a first-time user sees it explained there. */
export function SortBySelect({ value, onChange }: SortBySelectProps): JSX.Element {
  // `useId` rather than a fixed string: the All view and the List view can
  // both be mounted in the same document, and a duplicated id would be
  // invalid HTML and would point both selects at one hint.
  const hintId = useId();
  const reordered = hasReorderedTasks();
  const customHint = reordered
    ? "Drag a Task to reorder it."
    : "Drag a Task to start your own order.";

  return (
    <>
      <Hint hintKey="sort-by">
        <label>
          Sort by
          <select
            value={value}
            onChange={(event) => onChange(event.target.value as SortBy)}
            // Only described while "custom" is chosen — that's the only
            // state the hint below is rendered in. This doesn't collide with
            // `Hint`, which describes the wrapping label rather than the
            // select.
            aria-describedby={value === "custom" ? hintId : undefined}
          >
            <option value="custom">Custom</option>
            <option value="date">Date</option>
            <option value="priority">Priority</option>
            <option value="title">Title</option>
          </select>
        </label>
      </Hint>
      {value === "custom" && (
        <span id={hintId} className="hint">
          {customHint}
        </span>
      )}
    </>
  );
}
