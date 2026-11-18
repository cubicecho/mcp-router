import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { RequestHandlerExtra, RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import { pushNotification } from './notifications.ts';

/** What a request handler on a proxy server is handed beside the request. */
export type UpstreamExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/**
 * Builds the options a proxied `tools/call` is sent downstream with, from the upstream request it answers.
 *
 * @param server - The session's proxy server, which relayed progress is pushed to.
 * @param extra - The upstream request's own extra: its abort signal and its `_meta`.
 * @param timeoutMs - How long the downstream call may take.
 * @returns The signal, the timeout, and a progress relay when the caller asked for progress.
 *
 * @remarks
 * Without these a cancelled call kept running downstream, progress the server sent went nowhere, and every call was
 * cut off at the SDK's 60s whatever it was doing.
 *
 * The SDK replaces the request's `progressToken` with its own when `onprogress` is set, so the downstream reports
 * against the router's token and each report is re-sent under the caller's. It goes out on the session's standalone
 * stream rather than through `extra.sendNotification`: the sessions answer in JSON, and a transport in that mode
 * drops a notification tied to a request without a word. The SDK's client matches progress by token alone, so it
 * arrives either way.
 *
 * No `resetTimeoutOnProgress`, as in the pool's own `call()`: a bound a server can hold open by talking is not one.
 */
export function callOptions(server: Server, extra: UpstreamExtra, timeoutMs: number): RequestOptions {
  const progressToken = extra._meta?.progressToken;
  return {
    signal: extra.signal,
    timeout: timeoutMs,
    ...(progressToken === undefined
      ? {}
      : {
          onprogress: (progress) =>
            pushNotification(server, { method: 'notifications/progress', params: { ...progress, progressToken } }),
        }),
  };
}
