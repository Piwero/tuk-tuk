import { type Priority } from "../api";
import { PRIORITY_LABELS } from "../grouping";
import { Icon, type IconName } from "./Icon";

/** One signal-bar glyph per non-default level — one/two/three bars for
 * Low/Medium/High — so the levels read apart by shape alone. None has no
 * entry: it renders no indicator at all. */
const PRIORITY_ICON: Partial<Record<Priority, IconName>> = {
  low: "signal-low",
  medium: "signal-medium",
  high: "signal-high",
};

interface PriorityIndicatorProps {
  priority: Priority;
}

/** Priority reads as shape, not colour (#166): Low/Medium/High each render a
 * distinct glyph carrying an accessible name that states the level; None
 * renders nothing. Colour is never load-bearing here — never red, which
 * stays reserved for "overdue" elsewhere on the row — so the same glyph
 * reads correctly for anyone who can't distinguish hue.
 *
 * Shared by TaskRow (List/Smart List/Search rows) and KanbanView (cards) so
 * the mapping can't drift between surfaces. */
export function PriorityIndicator({ priority }: PriorityIndicatorProps): JSX.Element | null {
  const iconName = PRIORITY_ICON[priority];
  if (iconName === undefined) {
    return null;
  }
  const label = `Priority: ${PRIORITY_LABELS[priority]}`;
  return (
    <span className="priority-indicator" data-priority={priority} title={label} aria-label={label}>
      <Icon name={iconName} size={14} />
    </span>
  );
}
