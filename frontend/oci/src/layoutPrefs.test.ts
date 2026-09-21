import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyThemePreference,
  hasReorderedTasks,
  loadThemePreference,
  markTasksReordered,
  saveThemePreference,
  type ThemePreference,
} from "./layoutPrefs";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("theme preference persistence (issue #193)", () => {
  it("defaults to System when nothing is stored", () => {
    expect(loadThemePreference()).toBe("system");
  });

  it("round-trips each choice through storage", () => {
    for (const choice of ["light", "dark", "system"] as ThemePreference[]) {
      saveThemePreference(choice);
      expect(loadThemePreference()).toBe(choice);
    }
  });

  it("falls back to System for an unrecognised stored value", () => {
    localStorage.setItem("tuktuk.theme", "sepia");
    expect(loadThemePreference()).toBe("system");
  });

  it("falls back to System without throwing when storage reads throw", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(loadThemePreference()).toBe("system");
  });

  it("does not throw when storage writes throw", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(() => saveThemePreference("dark")).not.toThrow();
  });
});

describe("reordered-Tasks flag (issue #260)", () => {
  it("defaults to false when nothing is stored", () => {
    expect(hasReorderedTasks()).toBe(false);
  });

  it("flips to true after a drag and survives re-reads", () => {
    markTasksReordered();
    expect(hasReorderedTasks()).toBe(true);
  });

  it("falls back to false without throwing when storage reads throw", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(hasReorderedTasks()).toBe(false);
  });

  it("does not throw when storage writes throw", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    expect(() => markTasksReordered()).not.toThrow();
  });
});

describe("applyThemePreference (issue #193)", () => {
  it("stamps the explicit choice on <html>", () => {
    applyThemePreference("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    applyThemePreference("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("resolves System against the OS and follows a live flip", () => {
    let dark = false;
    const listeners = new Set<() => void>();
    const mql = {
      get matches() {
        return dark;
      },
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    };
    vi.stubGlobal("matchMedia", () => mql as unknown as MediaQueryList);

    applyThemePreference("system");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    dark = true;
    listeners.forEach((fn) => fn());
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("renders light when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    applyThemePreference("system");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});
