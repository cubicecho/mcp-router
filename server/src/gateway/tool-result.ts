import { isRecord } from '../core/is-record.ts';

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
 * @returns The result's text content joined by newlines, or a fixed message when it has none.
 */
export function toolErrorText(result: unknown): string {
  const content = isRecord(result) ? result.content : undefined;
  const text = Array.isArray(content)
    ? content
        .filter((item) => item.type === 'text')
        .map((item) => item.text)
        .join('\n')
    : '';
  return text || 'Tool reported an error (isError: true)';
}
