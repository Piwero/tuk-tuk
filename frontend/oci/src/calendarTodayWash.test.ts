import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Today's column wash must span the whole day, not stop part-way down it.
 * `.time-columns` is the scroll box (a flex row capped at 70vh); flex items
 * stretch to that capped height by default, so the day columns ended at
 * 70vh while their 24 hour cells overflowed them — the accent wash and rule
 * on today's column read as a stray blue block over the first hours. jsdom
 * applies no stylesheet, so the layout claim is checked against the CSS
 * source, as contentColumn.test.ts does. */

const css = readFileSync(resolve(process.cwd(), "src/components/CalendarView.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  expect(match, `${selector} rule not found`).not.toBeNull();
  return (match as RegExpExecArray)[2] ?? "";
}

describe("today's calendar column wash", () => {
  it("lets the day columns grow to their hour cells inside the capped scroll box", () => {
    const columns = rule(".time-columns");
    expect(columns).toMatch(/overflow-y:\s*auto/);
    expect(columns).toMatch(/align-items:\s*flex-start/);
  });
});
