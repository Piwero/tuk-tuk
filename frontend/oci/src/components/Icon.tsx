import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  CalendarRange,
  ChartColumn,
  Check,
  ChevronLeft,
  ChevronRight,
  FolderPlus,
  Inbox,
  Layers,
  ListChecks,
  LogOut,
  Menu,
  Pencil,
  Plus,
  Repeat,
  Smile,
  Sun,
  Timer,
  X,
  type LucideIcon,
} from "lucide-react";

/** The app's Lucide subset, keyed by the design system's icon names.
 * This wrapper is the single swap point if a bespoke icon set arrives. */
const ICONS = {
  archive: Archive,
  "archive-restore": ArchiveRestore,
  "calendar-days": CalendarDays,
  "calendar-range": CalendarRange,
  "chart-column": ChartColumn,
  check: Check,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "folder-plus": FolderPlus,
  inbox: Inbox,
  layers: Layers,
  "list-checks": ListChecks,
  "log-out": LogOut,
  menu: Menu,
  pencil: Pencil,
  plus: Plus,
  repeat: Repeat,
  smile: Smile,
  sun: Sun,
  timer: Timer,
  x: X,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

interface IconProps {
  name: IconName;
  /** 16px inline / rows, 18px sidebar, 20px toolbar. */
  size?: number;
}

export function Icon({ name, size = 16 }: IconProps): JSX.Element {
  const Glyph = ICONS[name];
  return <Glyph className="icon" size={size} strokeWidth={1.5} aria-hidden="true" />;
}
