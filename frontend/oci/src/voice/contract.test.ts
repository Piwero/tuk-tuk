import roster from "../../../../shared/voice-tool-roster.json";
import { describe, expect, it } from "vitest";

import { registerVoiceReads } from "./rpc";
import { FakeRoom } from "../test/fakeRoom";

describe("browser voice RPC contract", () => {
  it("registers exactly the roster voice reads and writes", () => {
    const room = new FakeRoom();
    registerVoiceReads(room as never);
    const registered = [...room.methods.keys()].sort();
    const expected = roster.tools
      .filter((tool) => tool.clients.includes("voice"))
      .map((tool) => tool.name)
      .sort();
    expect(registered).toEqual(expected);
    expect(roster.contract_version).toBe(1);
  });
});
