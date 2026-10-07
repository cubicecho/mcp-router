// Re-exported by the pool so this file can type the field without reaching into the SDK's
// module layout, which the pool pins through its peer dependency anyway.
import type { ServerCapabilities } from '@cubicecho/agent-mcp-pool';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

/**
 * Tells whether a failure means the downstream lacks the capability entirely.
 *
 * @param err - The thrown value.
 * @returns True when it answered "method not found", or our client-side capability assertion refused to send.
 */
function lacksCapability(err: unknown): boolean {
  if (err instanceof McpError && err.code === ErrorCode.MethodNotFound) {
    return true;
  }
  return err instanceof Error && /does not support/i.test(err.message);
}

/**
 * Run a downstream call, mapping a "capability not supported" failure to null.
 *
 * @typeParam T - What the call resolves to.
 * @param run - The downstream call.
 * @returns The call's result, or null when the downstream lacks the capability. Every other failure is rethrown.
 *
 * @remarks
 * A server that has the capability and fails is a real error, not an empty result.
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
 * What an endpoint advertises when it cannot know what is behind it: everything this proxy is able to relay.
 *
 * @remarks
 * Right for an aggregate, whose members are deliberately not connected while a client initializes. On a 1:1 endpoint
 * it is the fallback for a downstream that would not connect, where claiming everything is the safer error: a client
 * told a surface does not exist has lost the surface, one that gets an empty list has lost a round trip.
 */
export const PROXY_CAPABILITIES: ServerCapabilities = {
  tools: { listChanged: true },
  resources: { subscribe: true, listChanged: true },
  prompts: { listChanged: true },
  logging: {},
  completions: {},
};

/**
 * Works out what a 1:1 endpoint advertises: what the downstream itself declared, narrowed to what this proxy relays.
 *
 * @param [downstream] - The server's declared capabilities, as of its last connect; absent when it never connected.
 * @returns The narrowed capabilities, or {@link PROXY_CAPABILITIES} when `downstream` is absent.
 *
 * @remarks
 * `resources.subscribe` was once claimed unconditionally, so a client learned that a server cannot subscribe from the
 * failure of a subscribe it was invited to send. `listChanged` is mirrored rather than asserted because this endpoint
 * only ever relays such a notification, never originates one.
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
