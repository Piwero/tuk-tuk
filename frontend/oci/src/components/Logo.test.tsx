import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Logo } from "./Logo";

describe("Logo", () => {
  it("renders a square mark at the requested size", () => {
    const { container } = render(<Logo size={32} />);

    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "32");
    expect(svg).toHaveAttribute("height", "32");
    // The 48-unit authoring grid the icon PNGs are cut from — the mark is
    // scaled by the width/height, never by editing the viewBox.
    expect(svg).toHaveAttribute("viewBox", "0 0 48 48");
  });

  it("is decorative: it adds no text and no accessible name", () => {
    // The "Tuk Tuk" wordmark sits beside the mark everywhere it appears, so
    // naming the mark too would announce the app twice.
    const { container } = render(<Logo />);

    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    // Not toHaveTextContent("") — jest-dom matches an empty string against
    // anything. The mark must contribute no text at all, so compare exactly.
    expect(container.textContent).toBe("");
  });

  it("paints with currentColor so themes re-point it from CSS", () => {
    // Same contract as the Lucide subset in Icon.tsx: the component never
    // learns which theme is on — `.logo`'s colour does the work.
    const { container } = render(<Logo />);

    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("fill", "currentColor");
    expect(svg).toHaveClass("logo");
    // No child may hardcode its own fill, or it would ignore the theme.
    expect(svg?.querySelectorAll("[fill]")).toHaveLength(0);
  });

  it("defaults to the sidebar brand size", () => {
    const { container } = render(<Logo />);

    expect(container.querySelector("svg")).toHaveAttribute("width", "21");
  });
});
