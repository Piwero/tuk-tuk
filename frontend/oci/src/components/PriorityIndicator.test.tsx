import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PriorityIndicator } from "./PriorityIndicator";

describe("PriorityIndicator", () => {
  it("renders nothing for None", () => {
    const { container } = render(<PriorityIndicator priority="none" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("gives Low, Medium and High distinct accessible names", () => {
    const { rerender } = render(<PriorityIndicator priority="low" />);
    expect(screen.getByLabelText("Priority: Low")).toBeInTheDocument();

    rerender(<PriorityIndicator priority="medium" />);
    expect(screen.getByLabelText("Priority: Medium")).toBeInTheDocument();
    expect(screen.queryByLabelText("Priority: Low")).not.toBeInTheDocument();

    rerender(<PriorityIndicator priority="high" />);
    expect(screen.getByLabelText("Priority: High")).toBeInTheDocument();
    expect(screen.queryByLabelText("Priority: Medium")).not.toBeInTheDocument();
  });

  it("renders a visually distinct glyph per level, not just a color swap", () => {
    const { container: low } = render(<PriorityIndicator priority="low" />);
    const { container: medium } = render(<PriorityIndicator priority="medium" />);
    const { container: high } = render(<PriorityIndicator priority="high" />);

    // Each level renders its own Lucide glyph (shape differs), not a shared
    // path recolored — assert the icons are backed by distinct <svg> markup.
    const lowSvg = low.querySelector("svg")?.innerHTML;
    const mediumSvg = medium.querySelector("svg")?.innerHTML;
    const highSvg = high.querySelector("svg")?.innerHTML;
    expect(lowSvg).toBeDefined();
    expect(mediumSvg).toBeDefined();
    expect(highSvg).toBeDefined();
    expect(lowSvg).not.toBe(mediumSvg);
    expect(mediumSvg).not.toBe(highSvg);
    expect(lowSvg).not.toBe(highSvg);
  });
});
