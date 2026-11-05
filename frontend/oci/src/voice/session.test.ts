import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeVoiceTransport } from "../test/fakeVoiceTransport";
import { createVoiceSession } from "./session";

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

function setup(configure?: Parameters<typeof fakeVoiceTransport>[0]) {
  const fake = fakeVoiceTransport(configure);
  const states: string[] = [];
  const captions: string[] = [];
  const errors: string[] = [];
  const capturing: boolean[] = [];
  const session = createVoiceSession({
    createTransport: fake.factory,
    onState: (s) => states.push(s),
    onCaption: (c) => captions.push(c),
    onError: (e) => errors.push(e),
    onCapturing: (c) => capturing.push(c),
  });
  return { session, states, captions, errors, capturing, transport: () => fake.transports[0]! };
}

const agent = { speaking: false, contractVersion: "1" };

describe("provider-neutral voice session", () => {
  it("finishes starting continuous mode before stopping it", async () => {
    let finish!: () => void;
    const calls: string[] = [];
    const { session, transport } = setup((t) => {
      t.startConversation = async () => {
        calls.push("start");
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        calls.push("started");
      };
      t.stopConversation = async () => {
        calls.push("stop");
      };
    });
    await session.start();
    transport().events.onAgent(agent);
    session.startConversation();
    await vi.waitFor(() => expect(calls).toEqual(["start"]));
    session.stopConversation();
    expect(calls).toEqual(["start"]);
    finish();
    await vi.waitFor(() => expect(calls).toEqual(["start", "started", "stop"]));
    await session.stop();
  });
  it("connects with the local clock, then listens; stop disconnects and clears", async () => {
    const { session, states, transport } = setup();
    await session.start();
    expect(states).toEqual(["connecting", "listening"]);
    expect(transport().clock?.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(transport().clock?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(transport().connected).toBe(true);
    await session.stop();
    expect(transport().connected).toBe(false);
    expect(states.at(-1)).toBe("ended");
  });

  it("gives the transport the voice tools", async () => {
    const { session, transport } = setup();
    await session.start();
    expect(transport().context.tools.methods).toContain("get_agenda");
  });

  it("does not report listening when stopped while connect is pending", async () => {
    let finish!: () => void;
    const { session, states, transport } = setup((t) => {
      t.connect = () =>
        new Promise<void>((resolve) => {
          finish = () => resolve();
        });
    });
    const starting = session.start();
    await session.stop();
    finish();
    await starting;
    expect(transport().connected).toBe(false);
    expect(states).toEqual(["connecting", "ended"]);
  });

  it("shows utterance chunks before the stream ends, appended to earlier ones", async () => {
    const { session, captions, transport } = setup();
    await session.start();
    let finish!: () => void;
    transport().events.onUtterance({
      async *[Symbol.asyncIterator]() {
        yield "Hello";
        await new Promise<void>((resolve) => (finish = resolve));
        yield " world";
      },
    });
    await vi.waitFor(() => expect(captions).toContain("Hello"));
    finish();
    await vi.waitFor(() => expect(captions).toContain("Hello world"));
    transport().events.onUtterance({
      async *[Symbol.asyncIterator]() {
        yield "Bye";
      },
    });
    await vi.waitFor(() => expect(captions).toContain("Hello world Bye"));
    await session.stop();
    expect(captions.at(-1)).toBe("");
  });

  it("follows the agent speaking and listening", async () => {
    const { session, states, transport } = setup();
    await session.start();
    transport().events.onAgent({ ...agent, speaking: true });
    expect(states.at(-1)).toBe("speaking");
    transport().events.onAgent(agent);
    expect(states.at(-1)).toBe("listening");
  });

  it("shows the agent thinking between listening and speaking", async () => {
    const { session, states, transport } = setup();
    await session.start();
    transport().events.onAgent({ ...agent, thinking: true });
    expect(states.at(-1)).toBe("thinking");
    transport().events.onAgent({ ...agent, speaking: true });
    expect(states.at(-1)).toBe("speaking");
  });

  it("rejects an agent that never publishes a contract version", async () => {
    const { session, errors, transport } = setup();
    await session.start();
    vi.useFakeTimers();
    transport().events.onAgent({ speaking: false });
    vi.advanceTimersByTime(5000);
    expect(errors).toEqual(["Voice agent out of date — redeploy"]);
  });

  it("accepts a version that shows up before the grace period ends", async () => {
    const { session, errors, transport } = setup();
    await session.start();
    vi.useFakeTimers();
    transport().events.onAgent({ speaking: false });
    transport().events.onAgent(agent);
    vi.advanceTimersByTime(5000);
    expect(errors).toEqual([]);
  });

  it("ends when the agent contract differs", async () => {
    const { session, states, errors, transport } = setup();
    await session.start();
    transport().events.onAgent({ ...agent, contractVersion: "2" });
    expect(states.at(-1)).toBe("ended");
    expect(errors).toEqual(["Voice agent out of date — redeploy"]);
    expect(transport().connected).toBe(false);
  });

  it("ends quietly when the provider reports itself unavailable, without provider state", async () => {
    const { session, states, errors, transport } = setup();
    await session.start();
    transport().events.onAgent({ ...agent, endReason: "unavailable" });
    expect(localStorage.length).toBe(0);
    expect(states.at(-1)).toBe("ended");
    expect(errors).toEqual([]);
  });

  it("ends when the agent reports the session lapsed", async () => {
    const { session, states, transport } = setup();
    await session.start();
    transport().events.onAgent({ ...agent, endReason: "session_lapsed" });
    expect(states.at(-1)).toBe("ended");
  });

  it("enters recovery when the transport disconnects", async () => {
    const { session, states, transport } = setup();
    await session.start();
    transport().events.onDisconnected();
    expect(states.at(-1)).toBe("disconnected");
  });

  it("surfaces connection errors and microphone refusal", async () => {
    for (const [thrown, shown] of [
      [new Error("LiveKit is unreachable."), "LiveKit is unreachable."],
      [
        new Error("Permission denied"),
        "Microphone permission denied. Allow microphone access and try again.",
      ],
    ] as const) {
      const { session, states, errors } = setup((t) => {
        t.connect = async () => {
          throw thrown;
        };
      });
      await session.start();
      expect(errors).toEqual([shown]);
      expect(states.at(-1)).toBe("disconnected");
    }
  });

  it("ends on pagehide and on dispose", async () => {
    const a = setup();
    await a.session.start();
    window.dispatchEvent(new Event("pagehide"));
    expect(a.transport().connected).toBe(false);
    const b = setup();
    await b.session.start();
    b.session.dispose();
    expect(b.transport().connected).toBe(false);
  });

  it("does not capture speech just by connecting", async () => {
    const { session, capturing, transport } = setup();
    await session.start();
    expect(transport().turns).toEqual([]);
    expect(capturing).toEqual([]);
    session.dispose();
  });

  it("captures while a turn is held and submits it on release, in order", async () => {
    const { session, capturing, transport } = setup();
    await session.start();
    const held = session.startTurn();
    session.endTurn();
    await held;
    await vi.waitFor(() => expect(transport().turns).toEqual(["start", "end"]));
    expect(capturing).toEqual([true, false]);
  });

  it("abandons a held turn without submitting it", async () => {
    const { session, capturing, transport } = setup();
    await session.start();
    await session.startTurn();
    session.cancelTurn();
    await vi.waitFor(() => expect(transport().turns).toEqual(["start", "cancel"]));
    expect(capturing).toEqual([true, false]);
  });

  it("ignores a release or cancel when no turn is held, and a second press while held", async () => {
    const { session, transport } = setup();
    await session.start();
    session.endTurn();
    session.cancelTurn();
    await session.startTurn();
    await session.startTurn();
    session.endTurn();
    await vi.waitFor(() => expect(transport().turns).toEqual(["start", "end"]));
  });

  it("ignores turns before the session is ready and after it ended", async () => {
    const { session, capturing, transport } = setup((t) => {
      t.connect = () => new Promise<void>(() => undefined);
    });
    const starting = session.start();
    await session.startTurn();
    expect(capturing).toEqual([]);
    expect(transport().turns).toEqual([]);
    await session.stop();
    await session.startTurn();
    expect(transport().turns).toEqual([]);
    void starting;
  });

  it("releases the held turn when the session ends", async () => {
    const { session, capturing } = setup();
    await session.start();
    await session.startTurn();
    await session.stop();
    expect(capturing).toEqual([true, false]);
  });

  it("keeps the session when the agent is not ready for a turn yet", async () => {
    const { session, states, errors, capturing } = setup((t) => {
      t.startTurn = async () => {
        throw new Error("Voice agent is still joining. Try again in a moment.");
      };
    });
    await session.start();
    await session.startTurn();
    expect(errors).toEqual(["Voice agent is still joining. Try again in a moment."]);
    expect(states.at(-1)).toBe("listening");
    expect(capturing).toEqual([true, false]);
    session.dispose();
  });

  it("ends the session with the microphone message when the microphone is refused", async () => {
    const { session, states, errors } = setup((t) => {
      t.startTurn = async () => {
        throw new Error("Permission denied");
      };
    });
    await session.start();
    await session.startTurn();
    expect(errors).toEqual([
      "Microphone permission denied. Allow microphone access and try again.",
    ]);
    expect(states.at(-1)).toBe("disconnected");
  });
});
