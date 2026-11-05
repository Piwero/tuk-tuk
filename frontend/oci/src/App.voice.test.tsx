import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { installFakeApi } from "./test/fakeApi";
import { fakeVoiceTransport } from "./test/fakeVoiceTransport";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("Voice Assistant button", () => {
  it("starts and ends a session, with the tools available to the agent", async () => {
    installFakeApi({
      voiceLivekitUrl: "wss://test.livekit.cloud",
      voiceLivekitApiKey: "key",
      voiceSecretSet: true,
    });
    const fake = fakeVoiceTransport();
    render(<App voiceTransport={fake.factory} />);
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Start voice assistant" }));
    await waitFor(() => expect(fake.transports[0]?.connected).toBe(true));
    expect(fake.transports[0]!.context.tools.methods).toHaveLength(12);
    await userEvent.setup().click(screen.getByRole("button", { name: "End voice assistant" }));
    await waitFor(() => expect(fake.transports[0]?.connected).toBe(false));
    expect(screen.getByRole("button", { name: "Start voice assistant" })).toBeInTheDocument();
  });
});
