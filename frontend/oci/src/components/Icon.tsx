import {
  AlignLeft,
  Archive,
  ArchiveRestore,
  CalendarDays,
  CalendarRange,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Flame,
  Folder,
  FolderPlus,
  Inbox,
  Layers,
  ListChecks,
  LogOut,
  Menu,
  Moon,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Repeat,
  Search,
  Settings,
  SignalHigh,
  SignalLow,
  SignalMedium,
  Smile,
  Sparkles,
  Sun,
  Timer,
  Trash2,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

/** The app's Lucide subset, keyed by the design system's icon names.
 * This wrapper is the single swap point if a bespoke icon set arrives. */
const ICONS = {
  "align-left": AlignLeft,
  archive: Archive,
  "archive-restore": ArchiveRestore,
  "calendar-days": CalendarDays,
  "calendar-range": CalendarRange,
  "chart-column": ChartColumn,
  check: Check,
  "chevron-down": ChevronDown,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  flame: Flame,
  folder: Folder,
  "folder-plus": FolderPlus,
  inbox: Inbox,
  layers: Layers,
  "list-checks": ListChecks,
  "log-out": LogOut,
  menu: Menu,
  moon: Moon,
  "more-vertical": MoreVertical,
  pencil: Pencil,
  plus: Plus,
  "refresh-cw": RefreshCw,
  repeat: Repeat,
  search: Search,
  settings: Settings,
  "signal-high": SignalHigh,
  "signal-low": SignalLow,
  "signal-medium": SignalMedium,
  smile: Smile,
  sparkles: Sparkles,
  sun: Sun,
  timer: Timer,
  "trash-2": Trash2,
  users: Users,
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
