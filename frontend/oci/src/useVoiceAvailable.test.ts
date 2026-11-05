import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import * as api from "./api";
import { useVoiceAvailable } from "./useVoiceAvailable";

afterEach(() => vi.restoreAllMocks());

it("does not recheck in a tight loop when unavailableUntil is already past", async () => {
  const fetch = vi
    .spyOn(api, "fetchVoiceConfig")
    .mockResolvedValue({ configured: true } as Awaited<ReturnType<typeof api.fetchVoiceConfig>>);
  const provider = { transport: vi.fn(), unavailableUntil: () => new Date(Date.now() - 1000) };
  renderHook(() => useVoiceAvailable(provider));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(fetch).toHaveBeenCalledTimes(1);
});
