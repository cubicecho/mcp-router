import { isRecord } from '../is-record.ts';

/** A tool call that resolves with `isError: true` is a downstream failure, not a success. */
export function toolCallFailed(result: unknown): boolean {
  return isRecord(result) && Boolean(result.isError);
}

/** Best-effort error message for a tool call that resolved with `isError: true`. */
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
