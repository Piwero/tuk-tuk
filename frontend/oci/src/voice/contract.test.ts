import roster from "../../../../shared/voice-tool-roster.json";
import { describe, expect, it, vi } from "vitest";
import * as api from "../api";

import { registerVoiceReads as register } from "./rpc";
import { createVoiceTools } from "./tools";
import { FakeRoom, RpcError } from "../test/fakeRoom";

const registerVoiceReads = (room: FakeRoom, refresh?: () => void) =>
  register(room as never, createVoiceTools(refresh));

describe("LiveKit voice RPC binding", () => {
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
    registerVoiceReads(room);
    await room.methods.get("get_agenda")!({ payload: "{}" });
    expect(tasks.mock.calls[0]?.[0]).toBe("today");
    expect(events).toHaveBeenCalledOnce();
    expect(events.mock.calls[0]?.[0]).toBe(events.mock.calls[0]?.[1]);
    vi.restoreAllMocks();
  });
  it("reports and refreshes check items that landed before failure", async () => {
    vi.spyOn(api, "fetchTask").mockResolvedValue({ id: 1 } as never);
    vi.spyOn(api, "createCheckItem")
      .mockResolvedValueOnce({ id: 1 } as never)
      .mockRejectedValueOnce(new Error("offline"));
    const refresh = vi.fn();
    const room = new FakeRoom();
    registerVoiceReads(room, refresh);
    await room.methods.get("get_task")!({ payload: '{"task_id":1}' });
    await expect(
      room.methods.get("add_check_items")!({
        payload: '{"task_id":1,"titles":["first","second","third"]}',
      }),
    ).rejects.toThrow(/first.*second.*third/);
    expect(refresh).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("registers exactly the roster voice reads and writes", () => {
    const room = new FakeRoom();
    registerVoiceReads(room);
    const registered = [...room.methods.keys()].sort();
    const expected = roster.tools
      .filter((tool) => tool.clients.includes("voice"))
      .map((tool) => tool.name)
      .sort();
    expect(registered).toEqual(expected);
    expect(roster.contract_version).toBe(1);
  });

  it("translates tool failures to RpcError codes and keeps JSON payloads", async () => {
    const room = new FakeRoom();
    registerVoiceReads(room);
    vi.spyOn(api, "fetchSearchTasks")
      .mockResolvedValueOnce({ items: [], total: 0 } as never)
      .mockRejectedValueOnce(new api.ApiError("unauthorized", "expired", 401))
      .mockRejectedValueOnce(new Error("offline"));
    const search = room.methods.get("search_tasks")!;
    await expect(search({ payload: '{"query":"a"}' })).resolves.toBe('{"tasks":[],"total":0}');
    await expect(search({ payload: '{"query":"a"}' })).rejects.toMatchObject({
      code: 2001,
      message: "expired",
    });
    await expect(search({ payload: '{"query":"a"}' })).rejects.toBeInstanceOf(RpcError);
    await expect(search({ payload: "{" })).rejects.toMatchObject({ code: 1500 });
  });
});
