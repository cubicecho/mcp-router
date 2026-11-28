import {
  CallVia,
  type PromptGetRequest,
  type ResourceReadRequest,
  type ToolCallRequest,
  type WorkspaceConfig,
} from '@mcp-router/shared';
import { badInput, errorMessage, HttpError, upstreamFailed } from '../core/errors.ts';
import type { DownstreamClient } from './downstream.ts';
import type { InstanceKey } from './instance-key.ts';
import { workspaceEndpointScope } from './listings.ts';
import type { GatewayManager } from './manager.ts';
import { McpMethod } from './mcp-method.ts';
import type { ServerLookup } from './members.ts';
import { splitNamespacedName } from './naming.ts';
import { recordedCall } from './recorded-call.ts';

// The test calls the UI makes from its try-it panels: call a tool, read a resource, get a prompt, against one server
// or a workspace's aggregate. Each is recorded to the activity log under via 'ui'.

/** What a test call asks for, for its refusal messages. */
export const UiCallKind = {
  Tool: 'tool',
  Resource: 'resource',
  Prompt: 'prompt',
} as const;
/** One of the {@link UiCallKind} values. */
export type UiCallKind = (typeof UiCallKind)[keyof typeof UiCallKind];

/** Where one test call lands: the instance to reach, and the name or URI as that server knows it. */
export interface UiCallTarget {
  /** The instance the call is made against; a workspace member's key records under its own instance. */
  key: InstanceKey;
  /** The name or URI with any `<server>__` prefix removed. */
  target: string;
}

/**
 * Resolves what a test call asked for into where it lands.
 *
 * @param kind - What is being asked for, for the error message.
 * @param requested - The name or URI exactly as the caller sent it.
 * @returns The instance and the downstream name; throws BAD_USER_INPUT when it cannot place the request.
 */
export type LocateUiCall = (kind: UiCallKind, requested: string) => UiCallTarget;

/**
 * Places test calls on one server, under the names it gives them itself.
 *
 * @param name - The server's name; the caller has checked that it exists.
 * @returns The locator.
 */
export function locateOnServer(name: string): LocateUiCall {
  return (_kind, requested) => ({ key: name, target: requested });
}

/**
 * Places test calls in a workspace: a `<server>__` prefix picks the member, whose workspace instance is called.
 *
 * @param workspace - The workspace.
 * @param servers - Tells which members' servers still exist.
 * @returns The locator. It refuses a name whose prefix names no enabled member.
 */
export function locateInWorkspace(workspace: WorkspaceConfig, servers: ServerLookup): LocateUiCall {
  const scope = workspaceEndpointScope(workspace, servers);
  return (kind, requested) => {
    const split = splitNamespacedName(requested, scope.names());
    if (split === undefined) {
      throw badInput(`Unknown ${kind} "${requested}" (expected <server>__<name>).`);
    }
    return { key: scope.keyFor(split.serverName), target: split.name };
  };
}

/** What one test call is recorded as, and how its failure is worded. */
interface UiCall {
  /** The MCP method, e.g. `tools/call`. */
  method: string;
  /** Where it lands. */
  at: UiCallTarget;
  /** The request, recorded as the call's params. */
  params: unknown;
  /** The message of the UPSTREAM_FAILED error raised when the downstream call throws. */
  failLabel: string;
}

/**
 * Runs one downstream test call and records it to the activity log under via 'ui'.
 *
 * @typeParam T - What the call resolves to.
 * @param manager - Reaches the instance and holds its activity log.
 * @param call - What to record, and the label for a failure.
 * @param run - The call to make against the connected client.
 * @returns What `run` resolved to. Throws UPSTREAM_FAILED when it throws; an HttpError from the manager is rethrown.
 */
async function runUiCall<T>(
  manager: GatewayManager,
  call: UiCall,
  run: (client: DownstreamClient) => Promise<T>,
): Promise<T> {
  const { key, target } = call.at;
  try {
    return await recordedCall(
      (entry) => manager.recordActivity(key, entry),
      { via: CallVia.Ui, method: call.method, target, params: call.params },
      () => manager.withClient(key, run),
    );
  } catch (cause) {
    // The manager's own refusal (disabled, backed off, would not connect) already carries its code. It is logged all
    // the same, as it is for a proxied call: "why did my call fail?" is what the Activity view is for.
    if (cause instanceof HttpError) {
      throw cause;
    }
    throw upstreamFailed(call.failLabel, errorMessage(cause), { cause });
  }
}

/**
 * Calls one tool.
 *
 * @param manager - Makes the call and records it.
 * @param locate - Places the call on a server or a workspace member.
 * @param request - The tool's name and arguments.
 * @returns The tool's result as MCP returned it; `isError` marks a tool that reported its own failure.
 */
export function callUiTool(manager: GatewayManager, locate: LocateUiCall, request: ToolCallRequest) {
  const at = locate(UiCallKind.Tool, request.name);
  return runUiCall(
    manager,
    { method: McpMethod.ToolsCall, at, params: request, failLabel: `Tool "${request.name}" failed` },
    (client) => client.callTool({ name: at.target, arguments: request.arguments }),
  );
}

/**
 * Reads one resource: a static resource's URI, or one the caller expanded from a template.
 *
 * @param manager - Makes the call and records it.
 * @param locate - Places the call on a server or a workspace member.
 * @param request - The resource's URI.
 * @returns The resource's contents as MCP returned them.
 */
export function readUiResource(manager: GatewayManager, locate: LocateUiCall, request: ResourceReadRequest) {
  const at = locate(UiCallKind.Resource, request.uri);
  return runUiCall(
    manager,
    { method: McpMethod.ResourcesRead, at, params: request, failLabel: `Resource "${request.uri}" failed to read` },
    (client) => client.readResource({ uri: at.target }),
  );
}

/**
 * Renders one prompt.
 *
 * @param manager - Makes the call and records it.
 * @param locate - Places the call on a server or a workspace member.
 * @param request - The prompt's name and its string arguments.
 * @returns The prompt's messages as MCP returned them.
 */
export function getUiPrompt(manager: GatewayManager, locate: LocateUiCall, request: PromptGetRequest) {
  const at = locate(UiCallKind.Prompt, request.name);
  return runUiCall(
    manager,
    { method: McpMethod.PromptsGet, at, params: request, failLabel: `Prompt "${request.name}" failed` },
    (client) => client.getPrompt({ name: at.target, arguments: request.arguments }),
  );
}
