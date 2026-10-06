import type { ServerCapabilities } from '@cubicecho/agent-mcp-pool';

/**
 * What a downstream said about itself when it last connected.
 *
 * Both fields travel only in the initialize result, so they are read from a live
 * connection, never from config.
 */
export interface Handshake {
  /** The downstream's own instructions. Absent when it has none, or has not connected yet. */
  instructions?: string;
  /** What the downstream declared it supports. Absent when it has not connected yet. */
  capabilities?: ServerCapabilities;
}
