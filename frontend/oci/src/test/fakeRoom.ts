import { RoomEvent, RpcError } from "livekit-client";

export class FakeRoom {
  localParticipant = {
    setAttributes: async () => undefined,
    setMicrophoneEnabled: async () => undefined,
  };
  remoteParticipants = new Map<string, { attributes: Record<string, string> }>();
  methods = new Map<string, (data: { payload: string }) => Promise<string>>();
  handlers = new Map<string, (...args: never[]) => void>();
  connected = false;
  registerRpcMethod(name: string, handler: (data: { payload: string }) => Promise<string>): void {
    this.methods.set(name, handler);
  }
  unregisterRpcMethod(name: string): void {
    this.methods.delete(name);
  }
  registerTextStreamHandler(topic: string, handler: (...args: never[]) => void): void {
    this.handlers.set(topic, handler);
  }
  unregisterTextStreamHandler(topic: string): void {
    this.handlers.delete(topic);
  }
  on(event: string, handler: (...args: never[]) => void): void {
    this.handlers.set(event, handler);
  }
  off(event: string): void {
    this.handlers.delete(event);
  }
  async connect(): Promise<void> {
    this.connected = true;
  }
  async disconnect(): Promise<void> {
    this.connected = false;
    this.handlers.get(RoomEvent.Disconnected)?.();
  }
}
export { RpcError };
