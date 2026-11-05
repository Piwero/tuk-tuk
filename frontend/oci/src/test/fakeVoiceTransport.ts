import type { VoiceTransport, VoiceTransportContext } from "../voice/session";

/** Provider-neutral stand-in for a voice provider. Tests act as the agent by calling `events`,
 * and run tools through `call` exactly as the agent would. */
export class FakeVoiceTransport implements VoiceTransport {
  connected = false;
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
  call(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    return this.context.tools.execute(name, args);
  }
}

/** Pass `factory` as the transport factory; `transports` collects what sessions created.
 * `setup` runs on each new transport before the session uses it. */
export function fakeVoiceTransport(setup?: (transport: FakeVoiceTransport) => void) {
  const transports: FakeVoiceTransport[] = [];
  return {
    transports,
    factory: (context: VoiceTransportContext) => {
      const transport = new FakeVoiceTransport(context);
      setup?.(transport);
      transports.push(transport);
      return transport;
    },
  };
}
