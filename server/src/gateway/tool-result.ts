import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/** A tool call that resolves with `isError: true` is a downstream failure, not a success. */
export function toolCallFailed(result: unknown): boolean {
  return Boolean((result as CallToolResult | undefined)?.isError);
}

/** Best-effort error message for a tool call that resolved with `isError: true`. */
export function toolErrorText(result: unknown): string {
  const content = (result as CallToolResult).content;
  const text = Array.isArray(content)
    ? content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n')
    : '';
  return text || 'Tool reported an error (isError: true)';
}
