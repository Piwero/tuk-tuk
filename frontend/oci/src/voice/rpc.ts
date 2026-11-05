import { RpcError } from "livekit-client";

import type { VoiceRoom } from "./livekit";
import { type createVoiceTools, VoiceToolError } from "./tools";

/** LiveKit binding: registers every voice tool as an RPC method on the room, mapping payloads to
 * JSON args and tool failures to RpcError (2001 = login expired, 1500 = tool failed). Returns the
 * method names, for unregistering. */
export function registerVoiceReads(
  room: VoiceRoom,
  tools: ReturnType<typeof createVoiceTools>,
): string[] {
  for (const name of tools.methods)
    room.registerRpcMethod(name, async ({ payload }) => {
      try {
        return JSON.stringify(
          await tools.execute(name, JSON.parse(payload) as Record<string, unknown>),
        );
      } catch (error) {
        throw new RpcError(
          error instanceof VoiceToolError && error.authExpired ? 2001 : 1500,
          error instanceof Error ? error.message : "Voice tool failed",
          "",
        );
      }
    });
  return tools.methods;
}
