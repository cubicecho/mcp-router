// Re-exported by the pool so this file can type the field without reaching into the SDK's
// module layout, which the pool pins through its peer dependency anyway.
import type { ServerCapabilities } from '@cubicecho/agent-mcp-pool';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

/**
 * The downstream lacks the capability entirely: either it answered
 * "method not found" or our client-side capability assertion refused to send.
 * List endpoints treat this as an empty list.
 */
function lacksCapability(err: unknown): boolean {
  if (err instanceof McpError && err.code === ErrorCode.MethodNotFound) {
    return true;
  }
  return err instanceof Error && /does not support/i.test(err.message);
}

/**
 * Run a downstream call, mapping a "capability not supported" failure to null.
 * Every other failure propagates — a server that has the capability and fails
 * is a real error, not an empty result.
 */
export async function emptyOnMissing<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (cause) {
    if (lacksCapability(cause)) {
      return null;
    }
    throw cause;
  }
}

/**
 * What an endpoint advertises when it cannot know what is behind it: everything
 * this proxy is able to relay. `listChanged` and `subscribe` are relayed from the
 * downstream servers over a stateful session; completions/logging are forwarded
 * request/response.
 *
 * Right for an aggregate, whose members are deliberately not connected while a
 * client initializes — the union is the honest answer when any member might
 * support any of it. On a 1:1 endpoint it is the fallback for a downstream that
 * would not connect, where claiming everything is the safer error: a client that
 * asks and gets an empty list has lost a round trip, one told a surface does not
 * exist has lost the surface.
 */
export const PROXY_CAPABILITIES: ServerCapabilities = {
  tools: { listChanged: true },
  resources: { subscribe: true, listChanged: true },
  prompts: { listChanged: true },
  logging: {},
  completions: {},
};

/**
 * What a 1:1 endpoint advertises: what the downstream itself declared, narrowed to
 * the surfaces this proxy relays.
 *
 * Nothing is renamed or synthesized on this endpoint, so its capabilities are the
 * downstream's own for the same reason its `instructions` are. A proxy that claims
 * a capability the server behind it lacks makes a question the handshake exists to
 * answer unanswerable: `resources.subscribe` was claimed unconditionally, so a
 * client learned that a server cannot subscribe from the failure of a subscribe it
 * was invited to send. `listChanged` is mirrored rather than asserted because this
 * endpoint only ever relays such a notification — it never originates one.
 *
 * @param downstream The server's declared capabilities, as of its last connect.
 *   Absent when it has never connected — see {@link PROXY_CAPABILITIES}.
 */
export function proxyCapabilities(downstream?: ServerCapabilities): ServerCapabilities {
  if (!downstream) {
    return PROXY_CAPABILITIES;
  }
  return {
    ...(downstream.tools && { tools: { listChanged: downstream.tools.listChanged === true } }),
    ...(downstream.resources && {
      resources: {
        subscribe: downstream.resources.subscribe === true,
        listChanged: downstream.resources.listChanged === true,
      },
    }),
    ...(downstream.prompts && { prompts: { listChanged: downstream.prompts.listChanged === true } }),
    ...(downstream.logging && { logging: {} }),
    ...(downstream.completions && { completions: {} }),
  };
}
