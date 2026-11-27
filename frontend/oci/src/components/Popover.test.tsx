import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Popover } from "./Popover";

function Harness(): React.JSX.Element {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button ref={trigger} onClick={() => setOpen((o) => !o)}>
        Menu
      </button>
      <input aria-label="Elsewhere" />
      <Popover open={open} triggerRef={trigger} onClose={() => setOpen(false)}>
        <button>First</button>
        <button>Second</button>
      </Popover>
    </div>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Popover", () => {
  it("moves focus in on open and back to the trigger on Escape", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("button", { name: "First" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Menu" })).toHaveFocus();
  });

  it("closes on outside click without stealing focus from the clicked target", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Menu" }));
    await user.click(screen.getByRole("textbox", { name: "Elsewhere" }));
    expect(screen.queryByRole("button", { name: "First" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Elsewhere" })).toHaveFocus();
  });

  it("flips above the trigger when there is no room below", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const rect = this.classList.contains("popover")
        ? { top: 0, left: 0, bottom: 200, right: 100, width: 100, height: 200 }
        : { top: 550, left: 10, bottom: 580, right: 60, width: 50, height: 30 };
      return { ...rect, x: rect.left, y: rect.top, toJSON: () => rect } as DOMRect;
    });
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Menu" }));
    const surface = screen.getByRole("button", { name: "First" }).parentElement!;
    expect(surface.style.top).toBe("346px");
  });

  it("has no entrance animation", () => {
    const css = readFileSync(resolve(__dirname, "Popover.css"), "utf8");
    expect(css).not.toMatch(/animation|transition/);
  });
});
