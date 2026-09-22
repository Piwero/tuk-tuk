import { hasReorderedTasks } from "../layoutPrefs";

// The "Custom" sort option's label and hint (issue #260): a first-time user
// otherwise has no way to tell the default order is their own manual drag
// order rather than an arbitrary one. Shared by every "Sort by" control that
// offers "custom", so the wording only lives in one place.
export function customSortOptionLabel(): string {
  return hasReorderedTasks() ? "Custom (your order)" : "Custom (not yet arranged)";
}

export function CustomSortHint({ id }: { id: string }): JSX.Element {
  return (
    <span id={id} className="hint">
      {hasReorderedTasks() ? "Drag a Task to reorder it." : "Drag a Task to start your own order."}
    </span>
  );
}
