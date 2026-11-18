import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

/** A connected downstream client, as the gateway manager hands it out. */
export type DownstreamClient = Client;

/**
 * Runs one request against a downstream's client, by server name. What every
 * path to a downstream is handed in place of the client itself, so the redial
 * of a lost session (see `GatewayManager.withClient`) cannot be stepped around.
 * `session` is the upstream session the request is made for, which is where the
 * server's questions and log lines go while it runs.
 */
export type WithClient = <R>(
  name: string,
  run: (client: DownstreamClient) => Promise<R>,
  session?: Server,
) => Promise<R>;
