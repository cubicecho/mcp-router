import { type ApiError, ErrorCode } from '@mcp-router/shared';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { badInput, HttpError, internal, sendError } from '../core/errors.ts';
import { isRecord } from '../core/is-record.ts';

/** What a 500 says. The cause goes to the log, never to the caller: it can name files on the host. */
const INTERNAL_ERROR_MESSAGE = 'Internal server error';

/**
 * The status and message of an error Express's own middleware raised for a bad
 * request (a malformed or oversized body), which it marks as safe to show.
 *
 * @param err - The thrown value.
 * @returns The status and message to send, or undefined for any other error.
 */
function exposedClientError(err: unknown): { status: number; message: string } | undefined {
  if (isRecord(err) && err.expose === true && typeof err.status === 'number' && typeof err.message === 'string') {
    return { status: err.status, message: err.message };
  }
  return undefined;
}

/** Renders every thrown error as the JSON envelope { error, code, detail? }. */
export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    const detail = err.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
    sendError(res, badInput('Validation failed', detail));
    return;
  }
  if (err instanceof HttpError) {
    sendError(res, err);
    return;
  }
  const clientError = exposedClientError(err);
  if (clientError) {
    const body: ApiError = { error: clientError.message, code: ErrorCode.BadUserInput };
    res.status(clientError.status).json(body);
    return;
  }
  console.error('[api] unhandled error:', err);
  sendError(res, internal(INTERNAL_ERROR_MESSAGE));
}
