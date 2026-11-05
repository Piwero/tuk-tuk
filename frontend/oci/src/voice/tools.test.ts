import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../api";

import { createVoiceTools, VoiceToolError } from "./tools";

afterEach(() => vi.restoreAllMocks());

describe("neutral voice tool execution", () => {
  it("lists exactly the roster voice methods and runs one with JSON args", async () => {
    const tools = createVoiceTools();
    expect(tools.methods).toContain("get_agenda");
    vi.spyOn(api, "fetchSearchTasks").mockResolvedValue({ items: [], total: 0 } as never);
    await expect(tools.execute("search_tasks", { query: " milk " })).resolves.toEqual({
      tasks: [],
      total: 0,
    });
    expect(api.fetchSearchTasks).toHaveBeenCalledWith("milk", expect.anything());
  });

  it("rejects writes to tasks that were not read this session", async () => {
    const update = vi.spyOn(api, "updateTask");
    await expect(createVoiceTools().execute("complete_task", { task_id: 7 })).rejects.toThrow(
      /was not read in this session/,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("refreshes after an applied write only", async () => {
    const refresh = vi.fn();
    vi.spyOn(api, "createTask").mockResolvedValue({ id: 3, tags: [] } as never);
    vi.spyOn(api, "fetchSearchTasks").mockResolvedValue({ items: [], total: 0 } as never);
    const tools = createVoiceTools(refresh);
    await tools.execute("search_tasks", { query: "x" });
    expect(refresh).not.toHaveBeenCalled();
    await tools.execute("create_task", { title: "x" });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("flags an expired login without retrying", async () => {
    const fetch = vi
      .spyOn(api, "fetchSearchTasks")
      .mockRejectedValue(new api.ApiError("unauthorized", "expired", 401));
    const failure = await createVoiceTools()
      .execute("search_tasks", { query: "x" })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(VoiceToolError);
    expect((failure as VoiceToolError).authExpired).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("marks other failures as not auth related", async () => {
    vi.spyOn(api, "fetchSearchTasks").mockRejectedValue(new Error("offline"));
    const failure = await createVoiceTools()
      .execute("search_tasks", { query: "x" })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ message: "offline", authExpired: false });
  });
});
