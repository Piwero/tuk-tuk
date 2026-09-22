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

  it("renders List, Tag, Priority, Group by and Sort by", () => {
    renderControls();
    for (const name of ["List", "Tag", "Priority", "Group by", "Sort by"]) {
      expect(screen.getByRole("combobox", { name })).toBeInTheDocument();
    }
  });

  it("offers the caller's Lists and Tags alongside 'Any'", () => {
    renderControls();
    expect(screen.getByRole("option", { name: "Errands" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "urgent" })).toBeInTheDocument();
    expect(screen.getAllByRole("option", { name: "Any" })).toHaveLength(3);
  });

  it("changes only the field its control owns, leaving the rest alone", async () => {
    const user = userEvent.setup();
    const seen = renderUnderState({ listId: null, tagId: 7, priority: "high" });
    await user.selectOptions(screen.getByRole("combobox", { name: "List" }), "1");

    expect(seen.current).toEqual({ listId: 1, tagId: 7, priority: "high" });
  });

  it("reads 'Any' back as no filter rather than as an id", async () => {
    const user = userEvent.setup();
    const seen = renderUnderState({ ...BLANK, listId: 1 });
    await user.selectOptions(screen.getByRole("combobox", { name: "List" }), "");

    expect(seen.current).toEqual({ ...BLANK, listId: null });
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
