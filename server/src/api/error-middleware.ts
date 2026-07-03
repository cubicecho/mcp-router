import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../errors.ts';

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
  console.error('Unhandled API error:', err);
  res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
}
