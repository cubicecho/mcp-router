import { useMemo } from 'react';
import { type ToastOptions, useToast } from '@/components/ui/toast';
import { ApiRequestError } from './api.ts';

/** What a toast may carry besides its message. */
export interface ToastExtras extends ToastOptions {
  /** A second sentence, written after the message: a toast is one block of text. */
  description?: string;
}

/**
 * Joins a message and its description into the one block of text a toast draws.
 *
 * @param message - The first sentence.
 * @param [description] - What follows it.
 * @returns The message alone, or the two as sentences.
 */
function withDescription(message: string, description: string | undefined): string {
  return description ? `${message}. ${description}` : message;
}

/**
 * Words a failure for a toast.
 *
 * @param error - What a request threw.
 * @returns The message, followed by the API's detail when there is one; a non-Error is stringified.
 */
function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return error.detail ? `${error.message}: ${error.detail}` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Gives a component the app's toasts.
 *
 * @returns `success` for a confirmation, `error` for a plain failure, `apiError` for a failed request, and
 * `copyError` for a `CopyButton` whose clipboard write was refused.
 */
export function useToasts() {
  const show = useToast();
  return useMemo(
    () => ({
      success: (message: string, { description, ...options }: ToastExtras = {}) =>
        show(withDescription(message, description), 'positive', options),
      error: (message: string, { description, ...options }: ToastExtras = {}) =>
        show(withDescription(message, description), 'negative', options),
      apiError: (error: unknown) => show(apiErrorMessage(error)),
      copyError: () => show('Failed to copy to clipboard'),
    }),
    [show],
  );
}
