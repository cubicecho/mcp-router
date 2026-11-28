import { ApiRequestError } from './api.ts';
import { describeError } from './error-message.ts';

/**
 * Says why a request failed.
 *
 * @param error - What the request threw.
 * @returns The server's own message when it answered (it is written for the reader, and may well mention a "trusted
 * network" without being a network failure), otherwise `describeError`'s.
 */
export function failureMessage(error: unknown): string {
  return error instanceof ApiRequestError ? error.message : describeError(error);
}
