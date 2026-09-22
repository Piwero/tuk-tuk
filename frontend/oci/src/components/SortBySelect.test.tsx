import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { markTasksReordered } from "../layoutPrefs";
import { _resetHintSessionForTests } from "./Hint";
import { SortBySelect } from "./SortBySelect";

describe("SortBySelect", () => {
  beforeEach(() => {
    _resetHintSessionForTests();
    localStorage.clear();
  });

  it("offers Custom, Date, Priority and Title under the name 'Sort by'", () => {
    render(<SortBySelect value="date" onChange={vi.fn()} />);
    const select = screen.getByRole("combobox", { name: "Sort by" });
    expect([...select.querySelectorAll("option")].map((option) => option.value)).toEqual([
      "custom",
      "date",
      "priority",
      "title",
    ]);
  });

  it("reports the chosen sort to its caller", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SortBySelect value="date" onChange={onChange} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Sort by" }), "priority");
    expect(onChange).toHaveBeenCalledWith("priority");
  });

  it("explains Custom only while Custom is the chosen sort", () => {
    const { rerender } = render(<SortBySelect value="date" onChange={vi.fn()} />);
    expect(screen.queryByText(/Drag a Task/)).not.toBeInTheDocument();

    rerender(<SortBySelect value="custom" onChange={vi.fn()} />);
    expect(screen.getByText(/Drag a Task to start your own order/)).toBeInTheDocument();
  });

  it("names the Custom option plainly, before and after a drag", () => {
    const { rerender } = render(<SortBySelect value="custom" onChange={vi.fn()} />);
    expect(screen.getByRole("option", { name: "Custom" })).toBeInTheDocument();
    expect(screen.getByText(/Drag a Task to start your own order/)).toBeInTheDocument();

    markTasksReordered();
    rerender(<SortBySelect value="custom" onChange={vi.fn()} key="second" />);
    expect(screen.getByRole("option", { name: "Custom" })).toBeInTheDocument();
    expect(screen.getByText(/Drag a Task to reorder it/)).toBeInTheDocument();
  });

  it("describes the select by its Custom hint, so the explanation is announced", () => {
    render(<SortBySelect value="custom" onChange={vi.fn()} />);
    const select = screen.getByRole("combobox", { name: "Sort by" });
    const describedBy = select.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    const described = describedBy!
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    expect(described).toMatch(/Drag a Task/);
  });

  it("keeps two on-screen instances from colliding on one id", () => {
    render(
      <>
        <SortBySelect value="custom" onChange={vi.fn()} />
        <SortBySelect value="custom" onChange={vi.fn()} />
      </>,
    );
    const ids = screen
      .getAllByRole("combobox", { name: "Sort by" })
      .map((select) => select.getAttribute("aria-describedby"));
    expect(ids[0]).not.toBeNull();
    expect(ids[0]).not.toBe(ids[1]);
  });
});
