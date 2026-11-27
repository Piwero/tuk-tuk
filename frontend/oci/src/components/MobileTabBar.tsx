import "./MobileTabBar.css";
import { Icon, type IconName } from "./Icon";
import { IconButton } from "./IconButton";

interface MobileTabBarProps {
  todaySelected: boolean;
  calendarSelected: boolean;
  calendarEnabled: boolean;
  habitsSelected: boolean;
  habitsEnabled: boolean;
  /** Any destination that lives in the More sheet is current. */
  moreSelected: boolean;
  moreOpen: boolean;
  onSelectToday: () => void;
  onSelectCalendar: () => void;
  onQuickAdd: () => void;
  onSelectHabits: () => void;
  onToggleMore: () => void;
}

interface TabItemProps {
  icon: IconName;
  label: string;
  /** Overrides the visible label as the accessible name, where the label
   * alone would collide with a same-named sidebar button. */
  accessibleName?: string;
  selected: boolean;
  onClick: () => void;
}

/** Always a plain button, never an anchor (#170): this is a touch-first tab
 * bar with no "open in new tab" expectation, and staying button-only keeps
 * its names from colliding with the sidebar's same-named links, which render
 * at every width. Today is the exception that needs its own name, because
 * the sidebar's Today is a button too. */
function TabItem({
  icon,
  label,
  accessibleName,
  selected,
  onClick,
}: TabItemProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={selected ? "mobile-tab-item selected" : "mobile-tab-item"}
      aria-label={accessibleName}
      aria-current={selected ? "page" : undefined}
      onClick={onClick}
    >
      <Icon name={icon} size={20} />
      <span>{label}</span>
    </button>
  );
}

/** Mobile-only bottom tab bar (#170, #462): Today, Calendar, a centre
 * Quick-Add, Habits and More. More opens a sheet with every other
 * destination and the Lists/Folders/Tags tree, which replaced the drawer.
 * Hidden on desktop by CSS, where the sidebar is the nav surface. */
export function MobileTabBar({
  todaySelected,
  calendarSelected,
  calendarEnabled,
  habitsSelected,
  habitsEnabled,
  moreSelected,
  moreOpen,
  onSelectToday,
  onSelectCalendar,
  onQuickAdd,
  onSelectHabits,
  onToggleMore,
}: MobileTabBarProps): React.JSX.Element {
  return (
    <nav aria-label="Primary" className="mobile-tab-bar">
      <TabItem
        icon="sun"
        label="Today"
        accessibleName="Today tab"
        selected={todaySelected}
        onClick={onSelectToday}
      />
      {calendarEnabled && (
        <TabItem
          icon="calendar-days"
          label="Calendar"
          selected={calendarSelected}
          onClick={onSelectCalendar}
        />
      )}
      {/* Named "Quick add task", not "Quick add", so it stays distinct from
          the sidebar's trigger (#287). Glyph-only, so IconButton (#270). */}
      <IconButton
        icon="plus"
        size={24}
        label="Quick add task"
        className="mobile-tab-quick-add"
        onClick={onQuickAdd}
      />
      {habitsEnabled && (
        <TabItem icon="repeat" label="Habits" selected={habitsSelected} onClick={onSelectHabits} />
      )}
      <button
        type="button"
        className={moreSelected ? "mobile-tab-item selected" : "mobile-tab-item"}
        aria-current={moreSelected ? "page" : undefined}
        aria-expanded={moreOpen}
        aria-haspopup="dialog"
        onClick={onToggleMore}
      >
        <Icon name="menu" size={20} />
        <span>More</span>
      </button>
    </nav>
  );
}
