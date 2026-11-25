import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchHabitStats } from "./api";
import { fakeHabit, installFakeApi } from "./test/fakeApi";

// The Habit statistics read's client contract, against the fake API: the
// Habit start (`eligible_from`) is the server's, read in the browser's zone.
// How the Habits screens show it is a separate slice.

afterEach(() => {
  vi.restoreAllMocks();
});

function pretendBrowserZone(timeZone: string): void {
  const real = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (
    this: Intl.DateTimeFormat,
  ) {
    return { ...real.call(this), timeZone };
  });
}

describe("Habit statistics read", () => {
  it("sends the browser's time zone, never assuming UTC", async () => {
    pretendBrowserZone("America/New_York");
    const api = installFakeApi({ habits: [fakeHabit("Meditate")] });
    const habitId = api.habits[0]?.id ?? 0;

    await fetchHabitStats(habitId, "2026-07-03", 2026);

    expect(api.requests.map((r) => r.url)).toContain(
      `/api/v1/habits/${habitId}/stats?today=2026-07-03&tz=America%2FNew_York&year=2026`,
    );
  });

  it("starts a Habit on its creation day in the caller's zone", async () => {
    pretendBrowserZone("America/New_York");
    // 03:30Z on the 4th is still 23:30 on the 3rd in New York.
    const api = installFakeApi({
      habits: [fakeHabit("Meditate", { created_at: "2026-07-04T03:30:00Z" })],
    });

    const stats = await fetchHabitStats(api.habits[0]?.id ?? 0, "2026-07-05");

    expect(stats.eligible_from).toBe("2026-07-03");
  });

  it("pulls the start back to an earlier real Check-in", async () => {
    const api = installFakeApi({
      habits: [fakeHabit("Meditate", { created_at: "2026-07-03T10:00:00Z" })],
    });
    const habitId = api.habits[0]?.id ?? 0;
    api.checkIns.push({ id: 9501, habit_id: habitId, date: "2026-06-28", value: 1 });

    const stats = await fetchHabitStats(habitId, "2026-07-03");

    expect(stats.eligible_from).toBe("2026-06-28");
  });

  it("never starts after today", async () => {
    const api = installFakeApi({
      habits: [fakeHabit("Meditate", { created_at: "2026-07-04T10:00:00Z" })],
    });

    const stats = await fetchHabitStats(api.habits[0]?.id ?? 0, "2026-07-03");

    expect(stats.eligible_from).toBe("2026-07-03");
  });
});
