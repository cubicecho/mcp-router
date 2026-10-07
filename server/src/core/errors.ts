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
  /** The HTTP status `code` maps to. */
  readonly status: HttpStatus;
  /** Diagnostics beyond the one-line message, e.g. a child's stderr tail. */
  readonly detail?: string;

  /**
   * Builds the error, taking its HTTP status from the code.
   *
   * @param code - Decides the HTTP status.
   * @param message - The envelope's `error`.
   * @param [detail] - The envelope's `detail`; left out of it when empty.
   * @param [options] - Carries the `cause`.
   */
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

/**
 * Makes the factory for one error code.
 *
 * @param code - The code every error it builds carries.
 * @returns A factory taking the message, an optional detail and an optional cause.
 */
const factoryFor =
  (code: ErrorCode): HttpErrorFactory =>
  (message, detail, options) =>
    new HttpError(code, message, detail, options);

/** Builds a 400 for input the caller got wrong. */
export const badInput = factoryFor(ErrorCode.BadUserInput);
/** Builds a 401 for a missing or wrong credential. */
export const unauthenticated = factoryFor(ErrorCode.Unauthenticated);
/** Builds a 403 for a request that is not allowed. */
export const forbidden = factoryFor(ErrorCode.Forbidden);
/** Builds a 404 for something that does not exist. */
export const notFound = factoryFor(ErrorCode.NotFound);
/** Builds a 409 for a clash with what already exists. */
export const conflict = factoryFor(ErrorCode.Conflict);
/** Builds a 500 for a failure of the router's own. */
export const internal = factoryFor(ErrorCode.Internal);
/** Builds a 502 for a downstream server or registry that failed. */
export const upstreamFailed = factoryFor(ErrorCode.UpstreamFailed);
/** Builds a 503 for something that cannot be reached right now. */
export const unavailable = factoryFor(ErrorCode.Unavailable);
/** Builds a 504 for a downstream server or registry that did not answer in time. */
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

/**
 * Extract a human-readable message from an unknown thrown value.
 *
 * @param err - The thrown value.
 * @returns An Error's message, or the value as a string.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * Extract a message like errorMessage does, with an HttpError's detail appended.
 *
 * @param err - The thrown value.
 * @returns `message: detail` for an HttpError that has a detail, else what errorMessage gives.
 *
 * @remarks
 * The manager puts the actual diagnostics (e.g. a child's stderr tail) in the detail, while the message is a generic
 * one-liner like `Failed to connect to server "x"`.
 */
export function errorDetailMessage(err: unknown): string {
  if (err instanceof HttpError && err.detail) {
    return `${err.message}: ${err.detail}`;
  }
  return errorMessage(err);
}
