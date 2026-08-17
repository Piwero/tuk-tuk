/** Shared reading of the server-computed HabitStats (streak + heatmap) —
 * the yearly heatmap and the card's recent-days strip both bucket a
 * HeatmapDay's intensity the same way. */

/** The heatmap fill bucket (0..4) an intensity renders as. Level 0 is an
 * unfilled (missed, or not yet checked-in) day; a Numeric habit's partial
 * progress toward its Goal lands on 1-3, a full Check-in on 4. */
export function heatLevel(intensityValue: number): number {
  return intensityValue <= 0 ? 0 : Math.min(Math.ceil(intensityValue * 4), 4);
}
