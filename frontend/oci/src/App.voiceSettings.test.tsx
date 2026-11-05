import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { installFakeApi } from "./test/fakeApi";
import { fakeVoiceTransport } from "./test/fakeVoiceTransport";

// Note: fetch stays stubbed across tests (each test installs a fresh fake).
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

const views = () => within(screen.getByRole("navigation", { name: "Views" }));
const assistantLink = () => views().queryByRole("link", { name: "Assistant" });
const findAssistantLink = async () => {
  await screen.findByRole("navigation", { name: "Views" });
  return views().findByRole("link", { name: "Assistant" });
};

async function openVoiceSettings(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("link", { name: "Settings" }));
  return user;
}

describe("The Voice Assistant's settings (ADR 0015, issue #366)", () => {
  it("shows the saved URL and key and discloses where audio and data go", async () => {
    installFakeApi({
      voiceLivekitUrl: "wss://tuk.livekit.cloud",
      voiceLivekitApiKey: "APIabc",
      voiceSecretSet: true,
    });
    render(<App />);
    await openVoiceSettings();

    expect(await screen.findByLabelText("LiveKit URL")).toHaveValue("wss://tuk.livekit.cloud");
    expect(screen.getByLabelText("LiveKit API key")).toHaveValue("APIabc");
    expect(screen.getByText(/pass through LiveKit and its model providers/)).toBeInTheDocument();
    expect(screen.getByText(/zero.data.retention/i)).toBeInTheDocument();
  });

  it("shows a saved secret as a masked placeholder, never an input", async () => {
    installFakeApi({ voiceSecretSet: true });
    render(<App />);
    await openVoiceSettings();

    expect(await screen.findByText(/A LiveKit API secret is already saved/)).toBeInTheDocument();
    expect(screen.queryByLabelText("LiveKit API secret")).not.toBeInTheDocument();
  });

  it("saves URL, key and secret, then masks the secret", async () => {
    const fake = installFakeApi({});
    render(<App />);
    const user = await openVoiceSettings();

    await user.type(await screen.findByLabelText("LiveKit URL"), "wss://tuk.livekit.cloud");
    await user.type(screen.getByLabelText("LiveKit API key"), "APIabc");
    await user.type(screen.getByLabelText("LiveKit API secret"), "s3cret");
    await user.click(screen.getByRole("button", { name: "Save Voice settings" }));

    await screen.findByText(/A LiveKit API secret is already saved/);
    expect(screen.queryByDisplayValue("s3cret")).not.toBeInTheDocument();
    expect(fake.voiceLivekitUrl).toBe("wss://tuk.livekit.cloud");
    expect(fake.voiceLivekitApiKey).toBe("APIabc");
  });

  it("keeps the stored secret when editing only the URL", async () => {
    const fake = installFakeApi({
      voiceLivekitUrl: "wss://old.livekit.cloud",
      voiceLivekitApiKey: "APIabc",
      voiceSecretSet: true,
    });
    render(<App />);
    const user = await openVoiceSettings();

    const url = await screen.findByLabelText("LiveKit URL");
    await user.clear(url);
    await user.type(url, "wss://new.livekit.cloud");
    await user.click(screen.getByRole("button", { name: "Save Voice settings" }));

    await vi.waitFor(() => expect(fake.voiceLivekitUrl).toBe("wss://new.livekit.cloud"));
    expect(screen.getByText(/A LiveKit API secret is already saved/)).toBeInTheDocument();
  });

  it("reports the server's error when the first save omits the secret", async () => {
    installFakeApi({});
    render(<App />);
    const user = await openVoiceSettings();

    await user.type(await screen.findByLabelText("LiveKit URL"), "wss://tuk.livekit.cloud");
    await user.type(screen.getByLabelText("LiveKit API key"), "APIabc");
    await user.click(screen.getByRole("button", { name: "Save Voice settings" }));

    expect(await screen.findByText("A LiveKit API secret is required")).toBeInTheDocument();
  });

  it("clears all three fields with Remove", async () => {
    const fake = installFakeApi({
      voiceLivekitUrl: "wss://tuk.livekit.cloud",
      voiceLivekitApiKey: "APIabc",
      voiceSecretSet: true,
    });
    render(<App />);
    const user = await openVoiceSettings();

    await user.click(await screen.findByRole("button", { name: "Remove Voice configuration" }));

    expect(await screen.findByLabelText("LiveKit API secret")).toBeInTheDocument();
    expect(screen.getByLabelText("LiveKit URL")).toHaveValue("");
    expect(fake.voiceLivekitUrl).toBeNull();
    expect(fake.voiceSecretSet).toBe(false);
  });
});

describe("The Voice Assistant's availability (ADR 0015, issue #366)", () => {
  it("shows no Assistant entry while unconfigured", async () => {
    installFakeApi({});
    render(<App />);

    await screen.findByRole("link", { name: "Settings" });
    expect(assistantLink()).not.toBeInTheDocument();
  });

  it("shows the Assistant entry once configured", async () => {
    installFakeApi({
      voiceLivekitUrl: "wss://tuk.livekit.cloud",
      voiceLivekitApiKey: "APIabc",
      voiceSecretSet: true,
    });
    render(<App />);

    expect(await findAssistantLink()).toBeEnabled();
  });

  it("hides Voice while this month's free minutes are marked used up", async () => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    localStorage.setItem("tuktuk.voice.exhaustedMonth", month);
    installFakeApi({
      voiceLivekitUrl: "wss://tuk.livekit.cloud",
      voiceLivekitApiKey: "APIabc",
      voiceSecretSet: true,
    });
    render(<App />);

    await screen.findByRole("link", { name: "Settings" });
    expect(assistantLink()).not.toBeInTheDocument();
  });

  it("keeps a neutral provider available despite the LiveKit exhaustion marker", async () => {
    const now = new Date();
    localStorage.setItem(
      "tuktuk.voice.exhaustedMonth",
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
    );
    installFakeApi({
      voiceLivekitUrl: "wss://tuk.livekit.cloud",
      voiceLivekitApiKey: "APIabc",
      voiceSecretSet: true,
    });
    render(<App voiceProvider={fakeVoiceTransport().provider} />);

    expect(await findAssistantLink()).toBeEnabled();
  });

  it("shows Voice again when the marker is from a past month", async () => {
    localStorage.setItem("tuktuk.voice.exhaustedMonth", "2000-01");
    installFakeApi({
      voiceLivekitUrl: "wss://tuk.livekit.cloud",
      voiceLivekitApiKey: "APIabc",
      voiceSecretSet: true,
    });
    render(<App />);

    expect(await findAssistantLink()).toBeInTheDocument();
  });

  it("Voice appears after saving and disappears after removing, without a reload", async () => {
    installFakeApi({});
    render(<App />);
    const user = await openVoiceSettings();

    await user.type(await screen.findByLabelText("LiveKit URL"), "wss://tuk.livekit.cloud");
    await user.type(screen.getByLabelText("LiveKit API key"), "APIabc");
    await user.type(screen.getByLabelText("LiveKit API secret"), "s3cret");
    await user.click(screen.getByRole("button", { name: "Save Voice settings" }));
    expect(await findAssistantLink()).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Remove Voice configuration" }));
    await vi.waitFor(() => expect(assistantLink()).not.toBeInTheDocument());
  });
});
