import type { Server } from 'node:http';
import { keepAliveFetch } from '@cubicecho/agent-mcp-pool';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';

/** Idle time before an inbound keep-alive connection is closed, in ms. Above the 60 s nginx and ALB hold theirs. */
export const DEFAULT_KEEP_ALIVE_TIMEOUT_MS = 75_000;

/** Idle time before an outbound connection is closed when the remote names none, in ms. Below the 60 s most servers allow. */
export const DEFAULT_OUTBOUND_KEEP_ALIVE_TIMEOUT_MS = 30_000;

/**
 * Reads a millisecond duration from an env value.
 * @param value Raw env value.
 * @param fallback Used when the value is unset, not a whole number, or below `min`.
 * @param min Smallest accepted value.
 * @returns The duration in ms.
 */
function envMs(value: string | undefined, fallback: number, min: number): number {
  const parsed = Number(value?.trim() || Number.NaN);
  return Number.isInteger(parsed) && parsed >= min ? parsed : fallback;
}

/**
 * Keeps idle client connections open longer than Node's 5 s, so a tool call after a pause reuses one.
 * @param server The listening HTTP server; its `keepAliveTimeout` is set in place.
 * @param env Source of `HTTP_KEEP_ALIVE_TIMEOUT_MS`; `0` never closes an idle connection.
 * @returns The timeout applied, in ms.
 */
export function tuneInbound(server: Server, env: NodeJS.ProcessEnv = process.env): number {
  const timeoutMs = envMs(env.HTTP_KEEP_ALIVE_TIMEOUT_MS, DEFAULT_KEEP_ALIVE_TIMEOUT_MS, 0);
  server.keepAliveTimeout = timeoutMs;
  return timeoutMs;
}

/**
 * Builds the `fetch` the pool reaches remote servers with, which keeps an idle connection longer than undici's 4 s so a proxied call after a pause skips the TLS handshake.
 * @param env Source of `HTTP_OUTBOUND_KEEP_ALIVE_TIMEOUT_MS`; the default applies when it is unset or not a positive whole number.
 * @returns A `fetch` for `McpPool`. A remote's own `Keep-Alive: timeout` still wins over its timeout.
 */
export function outboundFetch(env: NodeJS.ProcessEnv = process.env): FetchLike {
  return keepAliveFetch(envMs(env.HTTP_OUTBOUND_KEEP_ALIVE_TIMEOUT_MS, DEFAULT_OUTBOUND_KEEP_ALIVE_TIMEOUT_MS, 1));
}
