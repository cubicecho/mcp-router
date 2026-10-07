import type { Server } from 'node:http';
import { keepAliveFetch } from '@cubicecho/agent-mcp-pool';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { keepAliveTimeoutMs, outboundKeepAliveTimeoutMs } from './config/env.ts';

/**
 * Keeps idle client connections open longer than Node's 5 s, so a tool call after a pause reuses one.
 * @param server The listening HTTP server; its `keepAliveTimeout` is set in place.
 * @param env Source of `HTTP_KEEP_ALIVE_TIMEOUT_MS`; `0` never closes an idle connection.
 * @returns The timeout applied, in ms.
 */
export function tuneInbound(server: Server, env?: NodeJS.ProcessEnv): number {
  const timeoutMs = keepAliveTimeoutMs(env);
  server.keepAliveTimeout = timeoutMs;
  return timeoutMs;
}

/**
 * Builds the `fetch` the pool reaches remote servers with, which keeps an idle connection longer than undici's 4 s so a proxied call after a pause skips the TLS handshake.
 * @param env Source of `HTTP_OUTBOUND_KEEP_ALIVE_TIMEOUT_MS`; the default applies when it is unset or not a positive whole number.
 * @returns A `fetch` for `McpPool`. A remote's own `Keep-Alive: timeout` still wins over its timeout.
 */
export function outboundFetch(env?: NodeJS.ProcessEnv): FetchLike {
  return keepAliveFetch(outboundKeepAliveTimeoutMs(env));
}
