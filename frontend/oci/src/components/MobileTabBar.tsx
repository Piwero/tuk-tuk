import { Icon, type IconName } from "./Icon";

interface MobileTabBarProps {
  tasksSelected: boolean;
  calendarSelected: boolean;
  habitsSelected: boolean;
  focusSelected: boolean;
  onSelectTasks: () => void;
  onSelectCalendar: () => void;
  onSelectHabits: () => void;
  onSelectFocus: () => void;
}

interface TabItemProps {
  icon: IconName;
  label: string;
  selected: boolean;
  onClick: () => void;
}

/** Always a plain button, never an anchor — unlike the sidebar's top nav
 * (#143), which needs anchors so its URL-addressable destinations support
 * cmd/ctrl-click and "open in new tab". This is a touch-first tab bar with
 * no such expectation, and staying button-only keeps its four destinations'
 * accessible names from colliding with the sidebar's same-named links,
 * which both surfaces render at every width. */
function TabItem({ icon, label, selected, onClick }: TabItemProps): JSX.Element {
  return (
    <button
      type="button"
      className={selected ? "mobile-tab-item selected" : "mobile-tab-item"}
      aria-current={selected ? "page" : undefined}
      onClick={onClick}
    >
      <Icon name={icon} size={20} />
      <span>{label}</span>
    </button>
  );
}

/** Mobile-only bottom tab bar (issue #170): puts the four most-used
 * destinations within thumb reach instead of behind the drawer, which used
 * to cost an open-tap-close round trip for every switch. Hidden entirely on
 * desktop by CSS — the drawer stays the one and only nav surface there, and
 * still holds every destination (including these four) at every width. */
export function MobileTabBar({
  tasksSelected,
  calendarSelected,
  habitsSelected,
  focusSelected,
  onSelectTasks,
  onSelectCalendar,
  onSelectHabits,
  onSelectFocus,
}: MobileTabBarProps): JSX.Element {
  return (
    <nav aria-label="Primary" className="mobile-tab-bar">
      <TabItem icon="list-checks" label="Tasks" selected={tasksSelected} onClick={onSelectTasks} />
      <TabItem
        icon="calendar-days"
        label="Calendar"
        selected={calendarSelected}
        onClick={onSelectCalendar}
      />
      <TabItem icon="repeat" label="Habits" selected={habitsSelected} onClick={onSelectHabits} />
      <TabItem icon="timer" label="Focus" selected={focusSelected} onClick={onSelectFocus} />
    </nav>
  );
}
