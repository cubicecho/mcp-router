import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

/**
 * The downstream lacks the capability entirely: either it answered
 * "method not found" or our client-side capability assertion refused to send.
 * List endpoints treat this as an empty list.
 */
export function lacksCapability(err: unknown): boolean {
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
