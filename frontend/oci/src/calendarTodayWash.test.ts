import { cssRuleBody, readStylesheets } from "./test/stylesheets";
import { describe, expect, it } from "vitest";

/** Today's column wash must span the whole day, not stop part-way down it.
 * `.time-columns` is the scroll box (a flex row capped at 70vh); flex items
 * stretch to that capped height by default, so the day columns ended at
 * 70vh while their 24 hour cells overflowed them — the accent wash and rule
 * on today's column read as a stray blue block over the first hours. jsdom
 * applies no stylesheet, so the layout claim is checked against the CSS
 * source, as contentColumn.test.ts does. */

const css = readStylesheets().replace(/\/\*[\s\S]*?\*\//g, "");

/** Every rule in every stylesheet, media-query rules included, with its
 * selector list split — so an override anywhere is seen, not only the
 * first match. */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector = "", body = ""]) => ({
  selectors: selector.split(",").map((s) => s.trim()),
  body,
}));

const TOP_ALIGNED = /align-items:\s*(flex-)?start\b/;

describe("today's calendar column wash", () => {
  it("lets the day columns grow to their hour cells inside the capped scroll box", () => {
    const columns = cssRuleBody(css, ".time-columns");
    expect(columns).toMatch(/overflow-y:\s*auto/);
    expect(columns).toMatch(TOP_ALIGNED);
  });

  it("never stretches the columns back to the scroll box in another rule", () => {
    const overrides = rules.filter(
      ({ selectors, body }) =>
        selectors.includes(".time-columns") && /align-items:/.test(body) && !TOP_ALIGNED.test(body),
    );
    expect(overrides.map(({ selectors }) => selectors.join(", "))).toEqual([]);
  });

  it("never sizes a day column to the scroll box itself", () => {
    const sized = rules.filter(
      ({ selectors, body }) =>
        selectors.some((selector) => selector.startsWith(".day-column")) &&
        (/align-self:\s*(stretch|normal)/.test(body) || /(^|[;\s])height:\s*100%/.test(body)),
    );
    expect(sized.map(({ selectors }) => selectors.join(", "))).toEqual([]);
  });
});
