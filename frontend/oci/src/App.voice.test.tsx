import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { installFakeApi } from "./test/fakeApi";
import { fakeVoiceTransport } from "./test/fakeVoiceTransport";

const configured = {
  voiceLivekitUrl: "wss://test.livekit.cloud",
  voiceLivekitApiKey: "key",
  voiceSecretSet: true,
};
const agent = { speaking: false, contractVersion: "1" };

beforeEach(() => window.history.replaceState(null, "", "/assistant"));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

async function setup(options: Parameters<typeof installFakeApi>[0] = configured) {
  const api = installFakeApi(options);
  const fake = fakeVoiceTransport();
  render(<App voiceProvider={fake.provider} />);
  return {
    api,
    fake,
    talk: () => screen.findByRole("button", { name: /connect|talk|connecting/i }),
  };
}

/** Connects and has the agent join, ready for a hold. */
async function ready() {
  const s = await setup();
  const button = await s.talk();
  fireEvent.pointerDown(button);
  fireEvent.pointerUp(button);
  await waitFor(() => expect(s.fake.transports[0]?.connected).toBe(true));
  act(() => s.fake.transports[0]!.events.onAgent(agent));
  const hold = await screen.findByRole("button", { name: "Hold to talk" });
  return { ...s, transport: s.fake.transports[0]!, hold };
}

describe("Voice view: continuous conversation", () => {
  it("starts explicitly and returns to hold-to-talk without losing the session", async () => {
    const { fake } = await setup();
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Start conversation" }));
    await waitFor(() => expect(fake.transports[0]?.connected).toBe(true));
    act(() => fake.transports[0]!.events.onAgent(agent));
    await waitFor(() => expect(fake.transports[0]?.turns).toEqual(["continuous"]));
    expect(screen.getByText("Continuous conversation")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Switch to hold-to-talk" }));
    await waitFor(() => expect(fake.transports[0]?.turns).toEqual(["continuous", "manual"]));
    expect(screen.getByRole("button", { name: "Hold to talk" })).toBeInTheDocument();
    expect(fake.transports).toHaveLength(1);
  });
});

describe("Voice view: starting", () => {
  it("opens without starting a session or activating the microphone", async () => {
    const { fake, talk } = await setup();
    expect(await talk()).toHaveAccessibleName("Press to connect");
    expect(fake.transports).toHaveLength(0);
  });

  it("connects on the first press without recording anything", async () => {
    const { fake, talk } = await setup();
    const button = await talk();
    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);
    await waitFor(() => expect(fake.transports[0]?.connected).toBe(true));
    expect(fake.transports[0]!.context.tools.methods).toHaveLength(12);
    expect(fake.transports[0]!.turns).toEqual([]);
    expect(fake.transports).toHaveLength(1);
  });

  it("never records a press made while connecting, even when the connection then completes", async () => {
    let finish!: () => void;
    const api = installFakeApi(configured);
    void api;
    const fake = fakeVoiceTransport((t) => {
      t.connect = () => new Promise<void>((resolve) => (finish = resolve));
    });
    render(<App voiceProvider={fake.provider} />);
    const button = await screen.findByRole("button", { name: "Press to connect" });
    fireEvent.pointerDown(button);
    await screen.findByRole("button", { name: "Connecting…" });
    expect(screen.getByRole("status")).toHaveTextContent("Connecting…");
    expect(screen.getByText(/10–20 seconds/)).toBeInTheDocument();
    fireEvent.pointerDown(button);
    await act(async () => finish());
    await screen.findByRole("button", { name: "Hold to talk" });
    fireEvent.pointerUp(button);
    expect(fake.transports[0]!.turns).toEqual([]);
  });

  it("connects from a plain activation, as a screen reader sends it", async () => {
    const { fake, talk } = await setup();
    await userEvent.setup().click(await talk());
    await waitFor(() => expect(fake.transports[0]?.connected).toBe(true));
    expect(fake.transports).toHaveLength(1);
  });
});

describe("Voice view: holding to talk", () => {
  it("captures while held with the pointer and submits on release", async () => {
    const { transport, hold } = await ready();
    fireEvent.pointerDown(hold);
    expect(await screen.findByRole("button", { name: "Release to send" })).toBeInTheDocument();
    fireEvent.pointerUp(hold);
    await waitFor(() => expect(transport.turns).toEqual(["start", "end"]));
    expect(screen.getByRole("button", { name: "Hold to talk" })).toBeInTheDocument();
  });

  it("holds with Space and Enter, ignoring key repeats", async () => {
    const { transport, hold } = await ready();
    for (const key of [" ", "Enter"]) {
      fireEvent.keyDown(hold, { key });
      fireEvent.keyDown(hold, { key, repeat: true });
      fireEvent.keyDown(hold, { key, repeat: true });
      fireEvent.keyUp(hold, { key });
    }
    await waitFor(() => expect(transport.turns).toEqual(["start", "end", "start", "end"]));
  });

  it("cancels, without submitting, when a finger slides off the control", async () => {
    const { transport, hold } = await ready();
    fireEvent.pointerDown(hold, { pointerType: "touch" });
    fireEvent.pointerMove(hold, { pointerType: "touch", clientX: 400, clientY: 400 });
    fireEvent.pointerUp(hold, { pointerType: "touch", clientX: 400, clientY: 400 });
    await waitFor(() => expect(transport.turns).toEqual(["start", "cancel"]));
  });

  it("cancels when the pointer is released off the control or leaves it", async () => {
    const { transport, hold } = await ready();
    fireEvent.pointerDown(hold);
    fireEvent.pointerLeave(hold);
    fireEvent.pointerDown(hold);
    fireEvent.pointerUp(hold, { clientX: 400 });
    await waitFor(() => expect(transport.turns).toEqual(["start", "cancel", "start", "cancel"]));
  });

  it("cancels the turn when the control loses focus or the window is left", async () => {
    const { transport, hold } = await ready();
    fireEvent.keyDown(hold, { key: " " });
    fireEvent.blur(hold);
    fireEvent.keyDown(hold, { key: " " });
    fireEvent.blur(window);
    fireEvent.keyDown(hold, { key: " " });
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() =>
      expect(transport.turns).toEqual(["start", "cancel", "start", "cancel", "start", "cancel"]),
    );
  });

  it("cancels the turn when the view changes, keeping the session", async () => {
    const { transport, hold, api } = await ready();
    void api;
    fireEvent.keyDown(hold, { key: " " });
    await userEvent.setup().click(screen.getByRole("tab", { name: "Text" }));
    await waitFor(() => expect(transport.turns).toEqual(["start", "cancel"]));
    expect(transport.connected).toBe(true);
    await userEvent.setup().click(screen.getByRole("tab", { name: "Voice" }));
    expect(await screen.findByRole("button", { name: "Hold to talk" })).toBeInTheDocument();
  });

  it("shows why a hold failed and stays usable", async () => {
    const { transport, hold } = await ready();
    transport.startTurn = async () => {
      throw new Error("Voice agent is still joining. Try again in a moment.");
    };
    fireEvent.pointerDown(hold);
    expect(await screen.findByRole("alert")).toHaveTextContent("still joining");
    expect(screen.getByRole("button", { name: "Hold to talk" })).toBeInTheDocument();
  });
});

describe("Voice view: state, captions and ending", () => {
  it("labels connecting, listening, thinking and speaking in text and drives the Aura", async () => {
    const { transport } = await ready();
    const aura = screen.getByTestId("aura");
    expect(screen.getByRole("status")).toHaveTextContent("Listening");
    expect(aura).toHaveAttribute("data-color", "#4772fa");
    expect(aura).toHaveAttribute("data-color-shift", "1.04");
    expect(aura).toHaveAttribute("data-state", "listening");
    act(() => transport.events.onAgent({ ...agent, thinking: true }));
    expect(screen.getByRole("status")).toHaveTextContent("Thinking");
    expect(aura).toHaveAttribute("data-state", "thinking");
    act(() => transport.events.onAgent({ ...agent, speaking: true }));
    expect(screen.getByRole("status")).toHaveTextContent("Speaking");
    expect(aura).toHaveAttribute("data-state", "speaking");
  });

  it("follows the page theme", async () => {
    localStorage.setItem("tuktuk.theme", "dark");
    try {
      await ready();
      await waitFor(() =>
        expect(screen.getByTestId("aura")).toHaveAttribute("data-theme-mode", "dark"),
      );
    } finally {
      document.documentElement.removeAttribute("data-theme");
    }
  });

  it("shows a still disc instead of the shader under reduced motion", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    await ready();
    expect(screen.queryByTestId("aura")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Listening");
  });

  it("shows the agent's captions and keeps them out of reach of a view switch", async () => {
    const { transport } = await ready();
    act(() =>
      transport.events.onUtterance(
        (async function* () {
          yield "You have two tasks today.";
        })(),
      ),
    );
    expect(await screen.findByLabelText("Captions")).toHaveTextContent("You have two tasks today.");
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Text" }));
    await user.click(screen.getByRole("tab", { name: "Voice" }));
    expect(screen.getByLabelText("Captions")).toHaveTextContent("You have two tasks today.");
  });

  it("ends the session, releasing the microphone and clearing captions", async () => {
    const { transport } = await ready();
    act(() =>
      transport.events.onUtterance(
        (async function* () {
          yield "Hello";
        })(),
      ),
    );
    await screen.findByLabelText("Captions");
    fireEvent.keyDown(screen.getByRole("button", { name: "Hold to talk" }), { key: " " });
    await userEvent.setup().click(screen.getByRole("button", { name: "End session" }));
    await waitFor(() => expect(transport.connected).toBe(false));
    expect(screen.queryByLabelText("Captions")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Disconnected");
    expect(screen.getByRole("button", { name: "Press to connect" })).toBeInTheDocument();
    expect(transport.turns).toEqual(["start"]);
  });

  it("stays connected through silence until the owner ends it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { transport } = await ready();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10 * 60_000);
      });
      expect(transport.connected).toBe(true);
      expect(screen.getByRole("status")).toHaveTextContent("Listening");
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts a fresh session after one ended", async () => {
    const { fake, transport } = await ready();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "End session" }));
    await waitFor(() => expect(transport.connected).toBe(false));
    await user.click(await screen.findByRole("button", { name: "Press to connect" }));
    await waitFor(() => expect(fake.transports[1]?.connected).toBe(true));
  });
});

describe("/assistant with Text and Voice", () => {
  it("offers both modes, text first, and leaves the text assistant working", async () => {
    installFakeApi({ ...configured, assistantAvailable: true });
    const fake = fakeVoiceTransport();
    render(<App voiceProvider={fake.provider} />);
    const tabs = await screen.findByRole("tablist", { name: "Assistant mode" });
    expect(within(tabs).getByRole("tab", { name: "Text" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(await screen.findByRole("textbox", { name: "Describe your day" })).toBeVisible();
    await userEvent.setup().click(within(tabs).getByRole("tab", { name: "Voice" }));
    expect(await screen.findByRole("button", { name: "Press to connect" })).toBeVisible();
    expect(fake.transports).toHaveLength(0);
  });

  it("opens on Voice when only voice is available, explaining the text mode", async () => {
    await setup();
    expect(await screen.findByRole("button", { name: "Press to connect" })).toBeVisible();
    await userEvent.setup().click(screen.getByRole("tab", { name: "Text" }));
    expect(screen.getByText(/text Assistant isn't available/i)).toBeVisible();
    expect(screen.getByRole("heading", { name: "Assistant" })).toBeInTheDocument();
  });

  it("opens on Text when only text is available, explaining the voice mode", async () => {
    installFakeApi({ assistantAvailable: true });
    render(<App />);
    expect(await screen.findByRole("textbox", { name: "Describe your day" })).toBeVisible();
    await userEvent.setup().click(screen.getByRole("tab", { name: "Voice" }));
    expect(screen.getByText(/Voice assistant isn't available/i)).toBeVisible();
  });
});
