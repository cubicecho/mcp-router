import { toast } from 'sonner';
import { ApiRequestError } from './api.ts';

/**
 * Shows the standard error toast for a failed mutation.
 *
 * @param error - Whatever was thrown; an `ApiRequestError`'s detail becomes the toast's description.
 */
export function toastApiError(error: unknown): void {
  if (error instanceof ApiRequestError) {
    toast.error(error.message, { description: error.detail });
    return;
  }
  toast.error(error instanceof Error ? error.message : String(error));
}

/** Shows the error toast for a `CopyButton` whose clipboard write was refused. */
export function toastCopyError(): void {
  toast.error('Failed to copy to clipboard');
}
