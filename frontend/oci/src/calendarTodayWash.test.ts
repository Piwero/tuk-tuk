import { cssRuleBody, readStylesheets } from "./test/stylesheets";
import { describe, expect, it } from "vitest";

const css = readStylesheets().replace(/\/\*[\s\S]*?\*\//g, "");

/** Every rule in every stylesheet, media-query rules included, with its
 * selector list split — so an override anywhere is seen, not only the
 * first match. */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector = "", body = ""]) => ({
  selectors: selector.split(",").map((s) => s.trim()),
  body,
}));

const TOP_ALIGNED = /align-items:\s*(flex-)?start\b/;

describe("today's calendar column wash (issue #597)", () => {
  it("lets mobile all-day task titles wrap instead of disappearing beside the checkbox", () => {
    const calendarCss = css.slice(css.indexOf(".calendar-toolbar {"));
    const mobile = calendarCss.slice(calendarCss.indexOf("@media (max-width: 720px)"));
    const banner = cssRuleBody(mobile, ".all-day-lane .calendar-banner");
    expect(banner).toMatch(/white-space:\s*normal/);
    expect(banner).toMatch(/overflow-wrap:\s*anywhere/);
    const title = cssRuleBody(mobile, ".time-block .block-title");
    expect(title).toMatch(/white-space:\s*normal/);
    expect(title).toMatch(/overflow-wrap:\s*anywhere/);
    const heading = cssRuleBody(mobile, ".calendar-toolbar h2");
    expect(heading).toMatch(/flex:\s*1 0 100%/);
  });

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

  it("keeps today's empty grid neutral and the default task fill distinct", () => {
    const today = rules.filter(({ selectors }) =>
      selectors.some((selector) => selector.startsWith(".day-column[data-today]")),
    );
    expect(today).toEqual([]);
    expect(cssRuleBody(css, ".time-columns")).toMatch(/background:\s*var\(--surface-card\)/);
    expect(cssRuleBody(css, ".time-block")).toMatch(/background:\s*var\(--accent-soft\)/);
    expect(cssRuleBody(css, ".week-day-header[data-today]")).toMatch(/var\(--accent/);
  });
});
