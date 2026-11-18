/** "45 min", "1 h 45 min" — Focus totals, shared by Focus and the Day rail. */
export function formatFocusTotal(seconds: number): string {
  const total = Math.round(seconds / 60);
  const hours = Math.floor(total / 60);
  return hours > 0 ? `${hours} h ${total % 60} min` : `${total} min`;
}
