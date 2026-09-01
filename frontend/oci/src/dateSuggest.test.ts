import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyDatePick,
  composeSchedule,
  DAY_TOKENS,
  type DateSuggestion,
  formatScheduleChipLabel,
  mergeSchedule,
  resolveClockTime,
  resolveDayToken,
  type ScheduleChip,
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
      expect(resolveDayToken(phrase, localNoon(localDate))).toMatchObject({
        token: phrase,
        dueDate: expected,
        isAllDay: true,
        time: null,
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
    const suggestion = suggestDates("@", 1, now, "UTC");
    expect(suggestion?.sigil).toBe("@");
    expect(suggestion?.start).toBe(0);
    expect(suggestion?.query).toBe("");
    expect(suggestion?.options.map((o) => o.token)).toEqual([...DAY_TOKENS]);
    expect(suggestion?.create).toBeNull();
  });

  it("narrows by case-insensitive prefix on the token", () => {
    const suggestion = suggestDates("buy milk @to", 12, now, "UTC");
    expect(suggestion?.start).toBe(9);
    expect(suggestion?.query).toBe("to");
    expect(suggestion?.options.map((o) => o.token)).toEqual(["today", "tomorrow"]);
  });

  it("carries the resolved due date on each option", () => {
    const suggestion = suggestDates("@tomorrow", 9, now, "UTC");
    expect(suggestion?.options[0]).toMatchObject({
      token: "tomorrow",
      dueDate: "2026-09-02T00:00:00Z",
      isAllDay: true,
    });
  });

  it("resolves a clock-time query to a single time chip anchored on today", () => {
    const suggestion = suggestDates("gym @8am", 8, now, "UTC");
    expect(suggestion?.options).toHaveLength(1);
    expect(suggestion?.options[0]).toMatchObject({
      dayIso: "2026-09-01",
      isAllDay: false,
      timeZone: "UTC",
      dueDate: "2026-09-01T08:00:00.000Z",
    });
    expect(suggestion?.options[0]?.time).toEqual({ token: "8am", hour: 8, minute: 0 });
  });

  it("stays inert when the sigil follows a non-whitespace character (me@work)", () => {
    expect(suggestDates("me@work", 7, now, "UTC")).toBeNull();
  });

  it("closes once a space ends the query", () => {
    expect(suggestDates("@today ", 7, now, "UTC")).toBeNull();
  });

  it("returns no options when nothing matches the prefix", () => {
    const suggestion = suggestDates("@zzz", 4, now, "UTC");
    expect(suggestion?.options).toEqual([]);
  });
});

describe("resolveClockTime", () => {
  it("parses 12-hour times with a meridiem", () => {
    expect(resolveClockTime("8am")).toEqual({ token: "8am", hour: 8, minute: 0 });
    expect(resolveClockTime("8:30pm")).toEqual({ token: "8:30pm", hour: 20, minute: 30 });
    expect(resolveClockTime("12am")).toEqual({ token: "12am", hour: 0, minute: 0 });
    expect(resolveClockTime("12pm")).toEqual({ token: "12pm", hour: 12, minute: 0 });
  });

  it("parses 24-hour times, which need their colon", () => {
    expect(resolveClockTime("14:00")).toEqual({ token: "14:00", hour: 14, minute: 0 });
    expect(resolveClockTime("09:05")).toEqual({ token: "09:05", hour: 9, minute: 5 });
  });

  it("rejects an ambiguous bare hour and out-of-range values", () => {
    expect(resolveClockTime("8")).toBeNull();
    expect(resolveClockTime("25:00")).toBeNull();
    expect(resolveClockTime("13pm")).toBeNull();
    expect(resolveClockTime("8:99")).toBeNull();
    expect(resolveClockTime("dave")).toBeNull();
  });
});

describe("composeSchedule / mergeSchedule", () => {
  const monday = resolveDayToken("today", localNoon("2026-09-07")) as ScheduleChip;
  const tuesday = resolveDayToken("tomorrow", localNoon("2026-09-07")) as ScheduleChip;

  it("a day with no time stays an all-day UTC-midnight chip", () => {
    expect(composeSchedule(monday, null, "UTC")).toMatchObject({
      dueDate: "2026-09-07T00:00:00Z",
      isAllDay: true,
      timeZone: null,
    });
  });

  it("a time attaches to the chip's day, stamping is_all_day false and the zone", () => {
    const timed = composeSchedule(monday, { token: "8am", hour: 8, minute: 0 }, "Europe/London");
    expect(timed).toMatchObject({ isAllDay: false, timeZone: "Europe/London" });
    expect(timed.dueDate).toContain("2026-09-07T");
  });

  it("a day pick keeps the standing time; a time pick keeps the standing day", () => {
    const withTime = composeSchedule(monday, { token: "8am", hour: 8, minute: 0 }, "UTC");
    // second day token → new day, same time
    const movedDay = mergeSchedule(withTime, tuesday, "UTC");
    expect(movedDay.dayIso).toBe("2026-09-08");
    expect(movedDay.time).toEqual({ token: "8am", hour: 8, minute: 0 });
    // a later time pick → same day, new time
    const timeOnly = composeSchedule(
      resolveDayToken("today", localNoon("2026-09-07")) as ScheduleChip,
      { token: "9pm", hour: 21, minute: 0 },
      "UTC",
    );
    const movedTime = mergeSchedule(movedDay, timeOnly, "UTC");
    expect(movedTime.dayIso).toBe("2026-09-08");
    expect(movedTime.time?.hour).toBe(21);
  });
});

describe("formatScheduleChipLabel", () => {
  const monday = resolveDayToken("monday", localNoon("2026-09-01")) as ScheduleChip;

  it("renders the day alone when there is no time", () => {
    expect(formatScheduleChipLabel(monday)).toBe("Monday");
  });

  it("renders the composed schedule when a time is attached", () => {
    expect(
      formatScheduleChipLabel(composeSchedule(monday, { token: "8am", hour: 8, minute: 0 }, "UTC")),
    ).toBe("Monday 8:00 AM");
    expect(
      formatScheduleChipLabel(
        composeSchedule(monday, { token: "14:30", hour: 14, minute: 30 }, "UTC"),
      ),
    ).toBe("Monday 2:30 PM");
  });
});

describe("applyDatePick", () => {
  const schedule: ScheduleChip = {
    token: "tomorrow",
    dayIso: "2026-09-02",
    time: null,
    dueDate: "2026-09-02T00:00:00Z",
    isAllDay: true,
    timeZone: null,
  };

  it("removes the sigil+query text and reports the committed schedule", () => {
    const suggestion: DateSuggestion = {
      sigil: "@",
      start: 5,
      query: "tom",
      options: [],
      create: null,
    };
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
    expect(applyDatePick("@today #fun", suggestion, schedule).text).toBe("day #fun");
  });
});
