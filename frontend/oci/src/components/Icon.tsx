import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  CalendarRange,
  ChartColumn,
  Check,
  ChevronLeft,
  ChevronRight,
  Folder,
  FolderPlus,
  Inbox,
  Layers,
  ListChecks,
  LogOut,
  Menu,
  Pencil,
  Plus,
  RefreshCw,
  Repeat,
  Settings,
  Smile,
  Sun,
  Timer,
  Trash2,
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
  folder: Folder,
  "folder-plus": FolderPlus,
  inbox: Inbox,
  layers: Layers,
  "list-checks": ListChecks,
  "log-out": LogOut,
  menu: Menu,
  pencil: Pencil,
  plus: Plus,
  "refresh-cw": RefreshCw,
  repeat: Repeat,
  settings: Settings,
  smile: Smile,
  sun: Sun,
  timer: Timer,
  "trash-2": Trash2,
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
