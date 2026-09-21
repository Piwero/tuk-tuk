import { describe, expect, it } from "vitest";

import { looksLikeDatePhrase } from "./quickAdd";

describe("looksLikeDatePhrase (issue #259)", () => {
  it.each([
    "dentist tuesday 3pm",
    "call mum on monday",
    "meeting next friday at 9am",
    "renew passport in march",
    "email board tomorrow",
    "sync at 8:30pm",
  ])("flags %s as date-shaped", (title) => {
    expect(looksLikeDatePhrase(title)).toBe(true);
  });

  it.each(["buy milk", "email board", "review UX report", "pay rent #finance !high"])(
    "leaves %s unflagged",
    (title) => {
      expect(looksLikeDatePhrase(title)).toBe(false);
    },
  );
});
