import { fireEvent, screen, within } from "@testing-library/react";

const long = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

/** Open the date popover named `label` and click the day `iso` (YYYY-MM-DD) in its calendar. */
export function pickDate(label: string, iso: string): void {
  fireEvent.click(screen.getByRole("button", { name: label }));
  const dialog = screen.getByRole("dialog", { name: `Choose ${label}` });
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  // Navigate by month until the day is visible.
  for (let i = 0; i < 240; i += 1) {
    const name = long.format(new Date(y, m - 1, d));
    const cell = within(dialog).queryAllByRole("button", { name })[0];
    if (cell !== undefined && !cell.className.includes("outside")) {
      fireEvent.click(cell);
      return;
    }
    const title = within(dialog).getByRole("grid").getAttribute("aria-labelledby") as string;
    const shown = document.getElementById(title)?.textContent ?? "";
    const target = new Date(y, m - 1, 1);
    const current = new Date(`${shown} 1`);
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: current < target ? "Next month" : "Previous month",
      }),
    );
  }
  throw new Error(`Could not reach ${iso}`);
}
