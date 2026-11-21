import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { playFocusRunEndSound } from "./notificationSound";

class FakeOscillator {
  type = "";
  frequency = { value: 0 };
  connect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}

class FakeGain {
  gain = {
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
  connect = vi.fn();
}

class FakeAudioContext {
  currentTime = 0;
  close = vi.fn();
  createOscillator(): FakeOscillator {
    return new FakeOscillator();
  }
  createGain(): FakeGain {
    return new FakeGain();
  }
}

describe("playFocusRunEndSound", () => {
  let originalAudioContext: typeof AudioContext | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    originalAudioContext = window.AudioContext;
    (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  });

  afterEach(() => {
    vi.useRealTimers();
    // The spies sit on FakeAudioContext.prototype, which outlives each test;
    // vi.spyOn on an already-spied method returns that same spy, so an
    // unrestored one carries its call count into the next test.
    vi.restoreAllMocks();
    (window as unknown as { AudioContext: typeof AudioContext | undefined }).AudioContext =
      originalAudioContext;
  });

  it("plays a two-tone rise when a focus session ends", () => {
    const createOscillatorSpy = vi.spyOn(FakeAudioContext.prototype, "createOscillator");

    playFocusRunEndSound("focus");

    expect(createOscillatorSpy).toHaveBeenCalledTimes(2);
  });

  it("plays a single calmer tone when a break ends", () => {
    const createOscillatorSpy = vi.spyOn(FakeAudioContext.prototype, "createOscillator");

    playFocusRunEndSound("break");

    expect(createOscillatorSpy).toHaveBeenCalledTimes(1);
  });

  it("does nothing when AudioContext is unavailable", () => {
    (window as unknown as { AudioContext: unknown }).AudioContext = undefined;

    expect(() => playFocusRunEndSound("focus")).not.toThrow();
  });
});
