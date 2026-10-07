import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../errors.ts';
import { isRecord } from '../is-record.ts';

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

/** Renders every thrown error as the JSON envelope { error, detail? }. */
export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      detail: err.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; '),
    });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, ...(err.detail ? { detail: err.detail } : {}) });
    return;
  }
  const clientError = exposedClientError(err);
  if (clientError) {
    res.status(clientError.status).json({ error: clientError.message });
    return;
  }
  console.error('Unhandled API error:', err);
  res.status(500).json({ error: INTERNAL_ERROR_MESSAGE });
}
