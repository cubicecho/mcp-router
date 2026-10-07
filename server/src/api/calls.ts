import { CallVia, promptGetRequestSchema, resourceReadRequestSchema, toolCallRequestSchema } from '@mcp-router/shared';
import type { Router } from 'express';
import { errorMessage, HttpError, upstreamFailed } from '../core/errors.ts';
import type { DownstreamClient } from '../gateway/downstream.ts';
import type { InstanceKey } from '../gateway/instance-key.ts';
import type { GatewayManager } from '../gateway/manager.ts';
import { McpMethod } from '../gateway/mcp-method.ts';
import { recordedCall } from '../gateway/recorded-call.ts';

export interface UiCallContext {
  method: string;
  target: string;
  params: unknown;
  failLabel: string;
}

/**
 * Run one downstream call invoked from the UI (tool call, resource read, prompt
 * get) and record it to the activity log under via 'ui', exactly like proxied
 * calls. A thrown downstream error becomes a 502; a server that could not be
 * reached at all keeps the status the manager gave it, and is recorded too. A
 * workspace member's key records under its own instance.
 */
async function runUiCall(
  manager: GatewayManager,
  key: InstanceKey,
  ctx: UiCallContext,
  run: (client: DownstreamClient) => Promise<unknown>,
): Promise<unknown> {
  try {
    return await recordedCall(
      (entry) => manager.recordActivity(key, entry),
      { via: CallVia.Ui, method: ctx.method, target: ctx.target, params: ctx.params },
      () => manager.withClient(key, run),
    );
  } catch (cause) {
    // The manager's own refusal — disabled, backed off, would not connect — already
    // carries its status. It is logged all the same, as it is for a proxied call:
    // "why did my call fail?" is what the Activity view is for.
    if (cause instanceof HttpError) {
      throw cause;
    }
    throw upstreamFailed(ctx.failLabel, errorMessage(cause), { cause });
  }
}

/** Where one UI call lands: the instance to reach, and the name or URI as that server knows it. */
export interface UiCallTarget {
  key: InstanceKey;
  target: string;
}

/**
 * Resolve what a UI call asked for into where it lands.
 *
 * @param kind - What is being asked for ("tool", "resource", "prompt"), for the error message.
 * @param requested - The name or URI exactly as the caller sent it.
 */
export type LocateUiCall = (kind: string, requested: string) => UiCallTarget;

/**
 * Register the three test-call routes the UI uses — `/:id/tools/call`,
 * `/:id/resources/read` (a static resource's URI, or one the caller expanded
 * from a template) and `/:id/prompts/get`. Each is recorded like a proxied
 * call, under via 'ui'.
 *
 * @param scopeOf - Given the route's `:id`, rejects an unknown one and returns how its calls are located.
 */
export function registerUiCallRoutes(router: Router, manager: GatewayManager, scopeOf: (id: string) => LocateUiCall) {
  const register = <B>(
    method: string,
    kind: string,
    parse: (body: unknown) => B,
    requestedBy: (body: B) => string,
    failLabel: (requested: string) => string,
    run: (client: DownstreamClient, target: string, body: B) => Promise<unknown>,
  ): void => {
    router.post(`/:id/${method}`, async (req, res) => {
      const locate = scopeOf(req.params.id);
      const body = parse(req.body);
      const requested = requestedBy(body);
      const { key, target } = locate(kind, requested);
      const result = await runUiCall(
        manager,
        key,
        { method, target, params: body, failLabel: failLabel(requested) },
        (client) => run(client, target, body),
      );
      res.json(result);
    });
  };

  register(
    McpMethod.ToolsCall,
    'tool',
    (body) => toolCallRequestSchema.parse(body),
    (body) => body.name,
    (name) => `Tool "${name}" failed`,
    (client, name, body) => client.callTool({ name, arguments: body.arguments }),
  );
  register(
    McpMethod.ResourcesRead,
    'resource',
    (body) => resourceReadRequestSchema.parse(body),
    (body) => body.uri,
    (uri) => `Resource "${uri}" failed to read`,
    (client, uri) => client.readResource({ uri }),
  );
  register(
    McpMethod.PromptsGet,
    'prompt',
    (body) => promptGetRequestSchema.parse(body),
    (body) => body.name,
    (name) => `Prompt "${name}" failed`,
    (client, name, body) => client.getPrompt({ name, arguments: body.arguments }),
  );
}
