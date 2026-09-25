import { IconButton } from "./IconButton";

interface MobileQuickAddButtonProps {
  onClick: () => void;
}

/** Mobile-only Quick-Add trigger (issue #287): docked above the bottom tab
 * bar, within thumb reach, so Task creation no longer requires opening the
 * off-canvas drawer to reach the sidebar's trigger. Hidden entirely on
 * desktop by CSS — same convention as MobileTabBar.
 *
 * Its whole content is a glyph, so it goes through `IconButton` (#270)
 * rather than a hand-rolled button — `label` doubles as both the
 * accessible name and the visible hover/focus hint.
 *
 * Named "Quick add task" rather than "Quick add" because the sidebar's
 * trigger (`.quick-add-trigger`, `aria-label="Quick add"`) renders at every
 * width, not conditionally removed on mobile — the same collision
 * MobileTabBar.tsx solved for the sidebar's top nav. A distinct accessible
 * name keeps the two controls addressable independently even though both
 * exist in the DOM simultaneously, including while the drawer is open. */
export function MobileQuickAddButton({ onClick }: MobileQuickAddButtonProps): JSX.Element {
  return (
    <IconButton
      icon="plus"
      size={24}
      label="Quick add task"
      className="mobile-quick-add"
      onClick={onClick}
    />
  );
}
