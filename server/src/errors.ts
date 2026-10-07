import { type ApiError, ErrorCode, HttpStatus } from '@mcp-router/shared';
import type { Response } from 'express';

/** The HTTP status each error code is sent with. */
const STATUS_BY_CODE = {
  [ErrorCode.BadUserInput]: HttpStatus.BadRequest,
  [ErrorCode.Unauthenticated]: HttpStatus.Unauthorized,
  [ErrorCode.Forbidden]: HttpStatus.Forbidden,
  [ErrorCode.NotFound]: HttpStatus.NotFound,
  [ErrorCode.Conflict]: HttpStatus.Conflict,
  [ErrorCode.Internal]: HttpStatus.InternalServerError,
  [ErrorCode.UpstreamFailed]: HttpStatus.BadGateway,
  [ErrorCode.Unavailable]: HttpStatus.ServiceUnavailable,
  [ErrorCode.UpstreamTimeout]: HttpStatus.GatewayTimeout,
} as const satisfies Record<ErrorCode, HttpStatus>;

/** An error carrying an error code; rendered as the envelope { error, code, detail? } with the code's HTTP status. */
export class HttpError extends Error {
  readonly code: ErrorCode;
  readonly status: HttpStatus;
  readonly detail?: string;

  constructor(code: ErrorCode, message: string, detail?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HttpError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.detail = detail;
  }
}

/** Builds an HttpError of one code from a message, an optional detail and an optional cause. */
type HttpErrorFactory = (message: string, detail?: string, options?: ErrorOptions) => HttpError;

const factoryFor =
  (code: ErrorCode): HttpErrorFactory =>
  (message, detail, options) =>
    new HttpError(code, message, detail, options);

export const badInput = factoryFor(ErrorCode.BadUserInput);
export const unauthenticated = factoryFor(ErrorCode.Unauthenticated);
export const forbidden = factoryFor(ErrorCode.Forbidden);
export const notFound = factoryFor(ErrorCode.NotFound);
export const conflict = factoryFor(ErrorCode.Conflict);
export const internal = factoryFor(ErrorCode.Internal);
export const upstreamFailed = factoryFor(ErrorCode.UpstreamFailed);
export const unavailable = factoryFor(ErrorCode.Unavailable);
export const upstreamTimeout = factoryFor(ErrorCode.UpstreamTimeout);

/**
 * Send an error as the JSON envelope, with the status its code maps to.
 *
 * @param res - The response to write.
 * @param error - The error to render.
 */
export function sendError(res: Response, error: HttpError): void {
  const body: ApiError = { error: error.message, code: error.code, ...(error.detail ? { detail: error.detail } : {}) };
  res.status(error.status).json(body);
}

/** Extract a human-readable message from an unknown thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * Like errorMessage, but appends an HttpError's detail — the manager puts the
 * actual diagnostics (e.g. a child's stderr tail) there, while the message is
 * a generic one-liner like `Failed to connect to server "x"`.
 */
export function errorDetailMessage(err: unknown): string {
  if (err instanceof HttpError && err.detail) {
    return `${err.message}: ${err.detail}`;
  }
  return errorMessage(err);
}
