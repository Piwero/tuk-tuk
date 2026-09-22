import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type AllFilters, type Tag, type TaskList } from "../api";
import { AllViewControls } from "./AllViewControls";
import { _resetHintSessionForTests } from "./Hint";

const BLANK: AllFilters = { listId: null, tagId: null, priority: null };
const LISTS = [{ id: 1, name: "Errands" }] as TaskList[];
const TAGS = [{ id: 7, name: "urgent" }] as Tag[];

function renderControls(overrides: Partial<React.ComponentProps<typeof AllViewControls>> = {}): {
  onFiltersUpdate: ReturnType<typeof vi.fn>;
} {
  const onFiltersUpdate = vi.fn();
  render(
    <AllViewControls
      filters={BLANK}
      onFiltersUpdate={onFiltersUpdate}
      groupBy="section"
      onGroupByChange={vi.fn()}
      sortBy="date"
      onSortByChange={vi.fn()}
      lists={LISTS}
      tags={TAGS}
      {...overrides}
    />,
  );
  return { onFiltersUpdate };
}

/** Renders the controls under a real controlled parent, the way App does, so
 * a filter change is observed through the state it produces rather than by
 * calling the updater by hand. */
function renderUnderState(initial: AllFilters): { current: AllFilters } {
  const seen = { current: initial };
  function Harness(): JSX.Element {
    const [filters, setFilters] = useState(initial);
    seen.current = filters;
    return (
      <AllViewControls
        filters={filters}
        onFiltersUpdate={setFilters}
        groupBy="section"
        onGroupByChange={vi.fn()}
        sortBy="date"
        onSortByChange={vi.fn()}
        lists={LISTS}
        tags={TAGS}
      />
    );
  }
  render(<Harness />);
  return seen;
}

describe("AllViewControls", () => {
  beforeEach(() => {
    _resetHintSessionForTests();
    localStorage.clear();
  });

  it("shows a Filters button and Group by / Sort by at rest, with no bare filter combobox", () => {
    renderControls();
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Group by" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Sort by" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "List" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Tag" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Priority" })).not.toBeInTheDocument();
  });

  it("opens the popover to reveal List, Tag and Priority together", async () => {
    const user = userEvent.setup();
    renderControls();
    await user.click(screen.getByRole("button", { name: "Filters" }));

    expect(screen.getByRole("combobox", { name: "List" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Tag" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Priority" })).toBeInTheDocument();
  });

  it("offers the caller's Lists and Tags alongside 'Any'", async () => {
    const user = userEvent.setup();
    renderControls();
    await user.click(screen.getByRole("button", { name: "Filters" }));

    expect(screen.getByRole("option", { name: "Errands" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "urgent" })).toBeInTheDocument();
    expect(screen.getAllByRole("option", { name: "Any" })).toHaveLength(3);
  });

  it("changes only the field its control owns, leaving the rest alone", async () => {
    const user = userEvent.setup();
    const seen = renderUnderState({ listId: null, tagId: 7, priority: "high" });
    await user.click(screen.getByRole("button", { name: /Filters/ }));
    await user.selectOptions(screen.getByRole("combobox", { name: "List" }), "1");

    expect(seen.current).toEqual({ listId: 1, tagId: 7, priority: "high" });
  });

  it("reads 'Any' back as no filter rather than as an id", async () => {
    const user = userEvent.setup();
    const seen = renderUnderState({ ...BLANK, listId: 1 });
    await user.click(screen.getByRole("button", { name: /Filters/ }));
    await user.selectOptions(screen.getByRole("combobox", { name: "List" }), "");

    expect(seen.current).toEqual({ ...BLANK, listId: null });
  });

  it("reports the applied count in the button's accessible name", async () => {
    const user = userEvent.setup();
    renderUnderState({ listId: 1, tagId: 7, priority: null });
    expect(screen.getByRole("button", { name: "Filters (2 applied)" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Filters (2 applied)" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Priority" }), "high");
    expect(screen.getByRole("button", { name: "Filters (3 applied)" })).toBeInTheDocument();
  });

  it("renders a named, removable chip per applied filter", () => {
    renderUnderState({ listId: 1, tagId: null, priority: "high" });
    expect(screen.getByText("List: Errands")).toBeInTheDocument();
    expect(screen.getByText("Priority: High")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove filter: List: Errands" }),
    ).toBeInTheDocument();
  });

  it("removing a chip restores that dimension to unfiltered, leaving the rest alone", async () => {
    const user = userEvent.setup();
    const seen = renderUnderState({ listId: 1, tagId: 7, priority: "high" });
    await user.click(screen.getByRole("button", { name: "Remove filter: List: Errands" }));

    expect(seen.current).toEqual({ listId: null, tagId: 7, priority: "high" });
  });

  it("offers no clear-all with a single filter applied", () => {
    renderControls({ filters: { listId: 1, tagId: null, priority: null } });
    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();
  });

  it("clear-all restores the full, unfiltered state once two or more filters are applied", async () => {
    const user = userEvent.setup();
    const seen = renderUnderState({ listId: 1, tagId: 7, priority: null });
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(seen.current).toEqual(BLANK);
  });

  it("closes the popover on Escape and returns focus to the button", async () => {
    const user = userEvent.setup();
    renderControls();
    const button = screen.getByRole("button", { name: "Filters" });
    await user.click(button);
    expect(screen.getByRole("combobox", { name: "List" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("combobox", { name: "List" })).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it("offers grouping by None, Date, Priority and List", () => {
    renderControls();
    const groupBy = screen.getByRole("combobox", { name: "Group by" });
    expect([...groupBy.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "None",
      "Date",
      "Priority",
      "List",
    ]);
  });

  it("reports a chosen grouping and sort to its caller", async () => {
    const user = userEvent.setup();
    const onGroupByChange = vi.fn();
    const onSortByChange = vi.fn();
    renderControls({ onGroupByChange, onSortByChange });

    await user.selectOptions(screen.getByRole("combobox", { name: "Group by" }), "priority");
    await user.selectOptions(screen.getByRole("combobox", { name: "Sort by" }), "title");

    expect(onGroupByChange).toHaveBeenCalledWith("priority");
    expect(onSortByChange).toHaveBeenCalledWith("title");
  });
});
