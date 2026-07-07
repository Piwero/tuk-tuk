import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Mock dates module to use UTC for consistent test behavior across timezones.
// This fixes calendar tests but TaskDetail tests need additional work to use
// the mocked browserTimeZone properly in their expectations.
vi.mock("../dates", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../dates")>();

  return {
    ...actual,
    browserTimeZone: () => "UTC",
    instantOf: (dayIso: string, time: string): string => {
      // Create ISO string in UTC: YYYY-MM-DDTHH:MM:00.000Z
      const [hours = 0, minutes = 0] = time.split(":").map(Number);
      const timeStr = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00.000Z`;
      return `${dayIso}T${timeStr}`;
    },
  };
});
