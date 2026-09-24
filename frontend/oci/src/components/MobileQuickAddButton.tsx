import { Icon } from "./Icon";

interface MobileQuickAddButtonProps {
  onClick: () => void;
}

/** Mobile-only Quick-Add trigger (issue #287): docked above the bottom tab
 * bar, within thumb reach, so Task creation no longer requires opening the
 * off-canvas drawer to reach the sidebar's trigger. Hidden entirely on
 * desktop by CSS — same convention as MobileTabBar.
 *
 * Named "Quick add task" rather than "Quick add" because the sidebar's
 * trigger (`.quick-add-trigger`, `aria-label="Quick add"`) renders at every
 * width, not conditionally removed on mobile — the same collision
 * MobileTabBar.tsx solved for the sidebar's top nav. A distinct accessible
 * name keeps the two controls addressable independently even though both
 * exist in the DOM simultaneously, including while the drawer is open. */
export function MobileQuickAddButton({ onClick }: MobileQuickAddButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className="mobile-quick-add"
      aria-label="Quick add task"
      title="Quick add task"
      onClick={onClick}
    >
      <Icon name="plus" size={24} />
    </button>
  );
}
