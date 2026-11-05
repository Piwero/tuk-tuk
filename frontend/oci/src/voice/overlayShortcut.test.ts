import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_OVERLAY_SHORTCUT,
  loadOverlayShortcut,
  parseOverlayShortcut,
  saveOverlayShortcut,
} from "./overlayShortcut";

describe("voice overlay shortcut preference", () => {
  beforeEach(() => localStorage.clear());

  it("validates chords and rejects known application shortcut conflicts", () => {
    expect(parseOverlayShortcut("Alt+Shift+V")).toMatchObject({ key: "V", alt: true, shift: true });
    expect(parseOverlayShortcut("Shift+V")).toBeNull();
    expect(parseOverlayShortcut("Ctrl+Alt+N")).toBeNull();
    expect(parseOverlayShortcut("Ctrl+T")).toBeNull();
  });

  it("keeps saved shortcut in sync when storage rejects writes", () => {
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    saveOverlayShortcut("Ctrl+Shift+K");
    expect(loadOverlayShortcut()).toBe("Ctrl+Shift+K");
    set.mockRestore();
    saveOverlayShortcut(DEFAULT_OVERLAY_SHORTCUT);
  });

  it("persists locally and falls back to default for invalid stored values", () => {
    expect(loadOverlayShortcut()).toBe(DEFAULT_OVERLAY_SHORTCUT);
    saveOverlayShortcut("Ctrl+Shift+K");
    expect(loadOverlayShortcut()).toBe("Ctrl+Shift+K");
    localStorage.setItem("tuktuk.voice.overlayShortcut", "V");
    expect(loadOverlayShortcut()).toBe(DEFAULT_OVERLAY_SHORTCUT);
  });
});
