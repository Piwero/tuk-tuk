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
  const session = createVoiceSession({
    createTransport: fake.factory,
    onState: (s) => states.push(s),
    onCaption: (c) => captions.push(c),
    onError: (e) => errors.push(e),
  });
  return { session, states, captions, errors, transport: () => fake.transports[0]! };
}

const agent = { speaking: false, contractVersion: "1" };

describe("provider-neutral voice session", () => {
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

  it("ends when the transport disconnects", async () => {
    const { session, states, transport } = setup();
    await session.start();
    transport().events.onDisconnected();
    expect(states.at(-1)).toBe("ended");
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
      expect(states.at(-1)).toBe("ended");
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
});
