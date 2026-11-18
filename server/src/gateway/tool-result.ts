import { resultText } from '@cubicecho/agent-mcp-pool';
import { isRecord } from '../core/is-record.ts';
import { namespaceName } from './naming.ts';

/**
 * Tells whether a tool call that resolved is in fact a downstream failure.
 *
 * @param result - What `tools/call` resolved to.
 * @returns True when the result carries a truthy `isError`.
 */
export function toolCallFailed(result: unknown): boolean {
  return isRecord(result) && Boolean(result.isError);
}

/**
 * Extracts a best-effort error message from a tool call that resolved with `isError: true`.
 *
 * @param result - What `tools/call` resolved to.
 * @returns The result as the pool's `resultText` reads it — text blocks, embedded text resources, link URIs, and
 * `structuredContent` where the blocks come to nothing — or a fixed message when it says nothing at all.
 */
export function toolErrorText(result: unknown): string {
  return (isRecord(result) ? resultText(result) : '') || 'Tool reported an error (isError: true)';
}

/**
 * Namespaces the resource URIs a tool result hands its caller, for the aggregate endpoint.
 *
 * @typeParam T - What `tools/call` resolved to.
 * @param serverName - The server the result came from.
 * @param result - The result; not mutated.
 * @returns A copy whose `resource_link` blocks and embedded resources carry `<server>__`-prefixed URIs, as
 * `resources/list` gives them; the result itself when it has no content to rewrite.
 *
 * @remarks
 * A link is an invitation to read it back, and on the aggregate an unprefixed URI reads back as "Unknown resource".
 * Only the URI is rewritten, since it is the one field a read routes on; `structuredContent` is the tool's own data
 * and is left alone.
 */
export function namespaceResultLinks<T>(serverName: string, result: T): T {
  const content = isRecord(result) ? result.content : undefined;
  if (Array.isArray(content)) {
    return { ...result, content: content.map((block: unknown) => namespaceBlockUri(serverName, block)) };
  }
  return result;
}

/**
 * Namespaces the URI one content block names, if it names one.
 *
 * @param serverName - The server the block came from.
 * @param block - A content block; not mutated.
 * @returns A rewritten copy of a `resource_link` or an embedded `resource`, else the block itself.
 */
function namespaceBlockUri(serverName: string, block: unknown): unknown {
  if (isRecord(block) && block.type === 'resource_link' && typeof block.uri === 'string') {
    return { ...block, uri: namespaceName(serverName, block.uri) };
  }
  if (
    isRecord(block) &&
    block.type === 'resource' &&
    isRecord(block.resource) &&
    typeof block.resource.uri === 'string'
  ) {
    return { ...block, resource: { ...block.resource, uri: namespaceName(serverName, block.resource.uri) } };
  }
  return block;
}
