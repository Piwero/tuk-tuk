import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyDatePick,
  DAY_TOKENS,
  type DateSuggestion,
  resolveDayToken,
  suggestDates,
} from "./dateSuggest";

interface DateVector {
  phrase: string;
  localDate: string;
  expected: string;
}

const vectors: DateVector[] = JSON.parse(
  readFileSync(resolve(process.cwd(), "../../shared/quick-add-date-vectors.json"), "utf8"),
).vectors;

/** Local noon on `localDate` — noon keeps the calendar date unambiguous
 * regardless of the machine's timezone. */
const localNoon = (isoDate: string): Date => {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y as number, (m as number) - 1, d as number, 12, 0, 0);
};

describe("resolveDayToken — shared test vectors", () => {
  for (const { phrase, localDate, expected } of vectors) {
    it(`@${phrase} on ${localDate} resolves to ${expected}`, () => {
      expect(resolveDayToken(phrase, localNoon(localDate))).toEqual({
        token: phrase,
        dueDate: expected,
      });
    });
  }
});

describe("resolveDayToken — frontend-only vocabulary", () => {
  // 2026-09-01 is a Tuesday.
  const tue = localNoon("2026-09-01");

  it("@weekend is the upcoming Saturday", () => {
    expect(resolveDayToken("weekend", tue)?.dueDate).toBe("2026-09-05T00:00:00Z");
  });

  it("@weekend on a Saturday means that same day", () => {
    expect(resolveDayToken("weekend", localNoon("2026-09-05"))?.dueDate).toBe(
      "2026-09-05T00:00:00Z",
    );
  });

  it("@weekend on a Sunday means the day before (this weekend's Saturday)", () => {
    expect(resolveDayToken("weekend", localNoon("2026-09-06"))?.dueDate).toBe(
      "2026-09-05T00:00:00Z",
    );
  });

  it("@next-week is Monday of next week, not now + 7 days", () => {
    expect(resolveDayToken("next-week", tue)?.dueDate).toBe("2026-09-07T00:00:00Z");
  });

  it("a weekday name is strictly in the future — @tuesday on a Tuesday is 7 days out", () => {
    expect(resolveDayToken("tuesday", tue)?.dueDate).toBe("2026-09-08T00:00:00Z");
  });

  it("every token resolves to an all-day, UTC-midnight, hourless due date", () => {
    for (const token of DAY_TOKENS) {
      const resolved = resolveDayToken(token, tue);
      expect(resolved).not.toBeNull();
      expect(resolved?.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00Z$/);
    }
  });

  it("is case-insensitive", () => {
    expect(resolveDayToken("TOMORROW", tue)?.dueDate).toBe(
      resolveDayToken("tomorrow", tue)?.dueDate,
    );
  });

  it("resolves an unambiguous weekday abbreviation like a raw @mon token", () => {
    expect(resolveDayToken("mon", tue)?.dueDate).toBe(resolveDayToken("monday", tue)?.dueDate);
    expect(resolveDayToken("thu", tue)?.dueDate).toBe(resolveDayToken("thursday", tue)?.dueDate);
    expect(resolveDayToken("sat", tue)?.dueDate).toBe(resolveDayToken("saturday", tue)?.dueDate);
    // @mon on a Monday is seven days out (acceptance criterion 2).
    expect(resolveDayToken("mon", localNoon("2026-09-07"))?.dueDate).toBe("2026-09-14T00:00:00Z");
  });

  it("returns null for an unrecognised token", () => {
    expect(resolveDayToken("someday", tue)).toBeNull();
    expect(resolveDayToken("mo", tue)).toBeNull();
  });
});

describe("suggestDates", () => {
  const now = localNoon("2026-09-01");

  it("lists the whole vocabulary for a bare @ with no query", () => {
    const suggestion = suggestDates("@", 1, now);
    expect(suggestion?.sigil).toBe("@");
    expect(suggestion?.start).toBe(0);
    expect(suggestion?.query).toBe("");
    expect(suggestion?.options.map((o) => o.token)).toEqual([...DAY_TOKENS]);
    expect(suggestion?.create).toBeNull();
  });

  it("narrows by case-insensitive prefix on the token", () => {
    const suggestion = suggestDates("buy milk @to", 12, now);
    expect(suggestion?.start).toBe(9);
    expect(suggestion?.query).toBe("to");
    expect(suggestion?.options.map((o) => o.token)).toEqual(["today", "tomorrow"]);
  });

  it("carries the resolved due date on each option", () => {
    const suggestion = suggestDates("@tomorrow", 9, now);
    expect(suggestion?.options[0]).toEqual({ token: "tomorrow", dueDate: "2026-09-02T00:00:00Z" });
  });

  it("stays inert when the sigil follows a non-whitespace character (me@work)", () => {
    expect(suggestDates("me@work", 7, now)).toBeNull();
  });

  it("closes once a space ends the query", () => {
    expect(suggestDates("@today ", 7, now)).toBeNull();
  });

  it("returns no options when nothing matches the prefix", () => {
    const suggestion = suggestDates("@zzz", 4, now);
    expect(suggestion?.options).toEqual([]);
  });
});

describe("applyDatePick", () => {
  it("removes the sigil+query text and reports the committed schedule", () => {
    const suggestion: DateSuggestion = {
      sigil: "@",
      start: 5,
      query: "tom",
      options: [],
      create: null,
    };
    const schedule = { token: "tomorrow", dueDate: "2026-09-02T00:00:00Z" };
    expect(applyDatePick("read @tom", suggestion, schedule)).toEqual({
      text: "read ",
      caret: 5,
      schedule,
    });
  });

  it("leaves text after the caret untouched", () => {
    const suggestion: DateSuggestion = {
      sigil: "@",
      start: 0,
      query: "to",
      options: [],
      create: null,
    };
    const schedule = { token: "today", dueDate: "2026-09-01T00:00:00Z" };
    expect(applyDatePick("@today #fun", suggestion, schedule).text).toBe("day #fun");
  });
});
