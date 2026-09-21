import { describe, expect, it } from "vitest";

import { HINT_REGISTRY } from "./hintRegistry";

describe("HINT_REGISTRY", () => {
  it("has no empty entries", () => {
    for (const [key, copy] of Object.entries(HINT_REGISTRY)) {
      expect(copy.trim(), `entry for "${key}" is empty`).not.toBe("");
    }
  });
});
