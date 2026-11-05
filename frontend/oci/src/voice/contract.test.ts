import roster from "../../../../shared/voice-tool-roster.json";
import { describe, expect, it, vi } from "vitest";
import * as api from "../api";

import { registerVoiceReads } from "./rpc";
import { FakeRoom } from "../test/fakeRoom";

describe("browser voice RPC contract", () => {
  it("requests the local day for agenda tasks and events", async () => {
    const tasks = vi
      .spyOn(api, "fetchSmartTasks")
      .mockResolvedValue({ items: [], total: 0 } as never);
    const events = vi
      .spyOn(api, "fetchCalendarEvents")
      .mockResolvedValue({ events: [], failures: [] });
    vi.spyOn(api, "fetchHabits").mockResolvedValue({ items: [] } as never);
    vi.spyOn(api, "fetchLists").mockResolvedValue({ items: [] } as never);
    vi.spyOn(api, "fetchTags").mockResolvedValue({ items: [] } as never);
    const room = new FakeRoom();
    registerVoiceReads(room as never);
    await room.methods.get("get_agenda")!({ payload: "{}" });
    expect(tasks.mock.calls[0][0]).toBe("today");
    expect(events.mock.calls[0][0]).toBe(events.mock.calls[0][1]);
    vi.restoreAllMocks();
  });
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
