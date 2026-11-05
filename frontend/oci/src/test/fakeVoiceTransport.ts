import { screen, within } from "@testing-library/react";

import type { VoiceTransport, VoiceTransportContext } from "../voice/session";

/** Provider-neutral stand-in for a voice provider. Tests act as the agent by calling `events`,
 * and run tools through `call` exactly as the agent would. */
export class FakeVoiceTransport implements VoiceTransport {
  connected = false;
  /** What the session asked of the transport, in order: `start`, `end` or `cancel` a turn. */
  turns: string[] = [];
  clock: { timeZone: string; date: string } | undefined;
  constructor(readonly context: VoiceTransportContext) {}
  get events() {
    return this.context.events;
  }
  /** Replace to make `connect` fail or stay pending. */
  connect = async (clock: { timeZone: string; date: string }): Promise<void> => {
    this.clock = clock;
    this.connected = true;
  };
  async disconnect(): Promise<void> {
    this.connected = false;
  }
  /** Replace to make a turn call fail or stay pending. */
  startTurn = async (): Promise<void> => void this.turns.push("start");
  endTurn = async (): Promise<void> => void this.turns.push("end");
  cancelTurn = async (): Promise<void> => void this.turns.push("cancel");
  startConversation = async (): Promise<void> => void this.turns.push("continuous");
  stopConversation = async (): Promise<void> => void this.turns.push("manual");
  call(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    return this.context.tools.execute(name, args);
  }
}

/** Pass `provider` to `App`; `transports` collects what sessions created.
 * `setup` runs on each new transport before the session uses it. */
export function fakeVoiceTransport(setup?: (transport: FakeVoiceTransport) => void) {
  const transports: FakeVoiceTransport[] = [];
  const factory = (context: VoiceTransportContext) => {
    const transport = new FakeVoiceTransport(context);
    setup?.(transport);
    transports.push(transport);
    return transport;
  };
  return {
    transports,
    factory,
    provider: { transport: factory, unavailableUntil: () => undefined },
  };
}

/** Opens the Voice view and presses connect once, as the owner starts a push-to-talk session,
 * then returns to the task list: the session lives above every view, so it carries on. */
export async function connectVoiceFromAssistant(user: {
  click: (element: Element) => Promise<void>;
}): Promise<void> {
  const nav = await screen.findByRole("navigation", { name: "Views" });
  await user.click(await within(nav).findByRole("link", { name: "Assistant" }));
  await user.click(await screen.findByRole("button", { name: "Press to connect" }));
}

/** Back to the All list, where tasks the agent writes show up; the session carries on. */
export async function backToAllTasks(user: { click: (element: Element) => Promise<void> }) {
  const nav = await screen.findByRole("navigation", { name: "Smart Lists" });
  await user.click(await within(nav).findByRole("button", { name: "All" }));
}
