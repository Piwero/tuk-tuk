/** Shared visual defaults. */

/** Default accent for new Lists and Tags (TickTick blue). */
export const DEFAULT_ACCENT = "#4772fa";

export interface Swatch {
  name: string;
  value: string;
}

/** The curated accents offered in colour pickers, mirroring --swatch-* in tokens.css. */
export const ACCENT_PALETTE: readonly Swatch[] = [
  { name: "Blue", value: "#4772fa" },
  { name: "Indigo", value: "#5b5bd6" },
  { name: "Plum", value: "#8b5cf6" },
  { name: "Pink", value: "#d6409f" },
  { name: "Red", value: "#e5484d" },
  { name: "Orange", value: "#f76b15" },
  { name: "Amber", value: "#eda812" },
  { name: "Lime", value: "#99d52a" },
  { name: "Green", value: "#2da44e" },
  { name: "Teal", value: "#12a594" },
  { name: "Cyan", value: "#00a2c7" },
  { name: "Slate", value: "#8b8d98" },
];
