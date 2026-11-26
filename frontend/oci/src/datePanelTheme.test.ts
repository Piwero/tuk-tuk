import { cssRuleBody, readStylesheets } from "./test/stylesheets";
import { describe, expect, it } from "vitest";

/** The date panel's day buttons (Task detail's Due date, every DatePopover)
 * are bare <button>s. With no background of their own they fell back to the
 * browser's light button face while inheriting the theme's ink, so in dark
 * mode the day numbers were light text on a light-grey tile. jsdom applies
 * no stylesheet, so the claim is checked against the CSS source, as
 * calendarTodayWash.test.ts does. */

const css = readStylesheets().replace(/\/\*[\s\S]*?\*\//g, "");

describe("date panel day buttons follow the theme", () => {
  it("paint their own ground and ink instead of the browser's button face", () => {
    const day = cssRuleBody(css, ".date-popover-day");
    expect(day).toMatch(/(^|[;\s])background:\s*transparent/);
    expect(day).toMatch(/(^|[;\s])border:\s*0/);
    expect(day).toMatch(/(^|[;\s])color:\s*var\(--text-primary\)/);
  });

  it("dim out-of-month days with a text token, not opacity over a fill", () => {
    const outside = cssRuleBody(css, ".date-popover-day.outside");
    expect(outside).toMatch(/color:\s*var\(--text-tertiary\)/);
    expect(outside).not.toMatch(/opacity:/);
  });

  it("label the picked day with ink meant for a filled accent", () => {
    const selected = cssRuleBody(css, ".date-popover-day.selected");
    expect(selected).toMatch(/background:\s*var\(--accent\)/);
    expect(selected).toMatch(/color:\s*var\(--text-inverse\)/);
  });

  it("mark today even when it is not the picked day", () => {
    expect(cssRuleBody(css, '.date-popover-day[aria-current="date"]')).toMatch(
      /color:\s*var\(--text-accent\)/,
    );
  });
});
