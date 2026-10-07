/** The HTTP statuses the router sends, and its UI and tests read. */
export const HttpStatus = {
  Ok: 200,
  Created: 201,
  NoContent: 204,
  BadRequest: 400,
  Unauthorized: 401,
  Forbidden: 403,
  NotFound: 404,
  Conflict: 409,
  InternalServerError: 500,
  BadGateway: 502,
  ServiceUnavailable: 503,
  GatewayTimeout: 504,
} as const;
export type HttpStatus = (typeof HttpStatus)[keyof typeof HttpStatus];

/** Why a request failed, as the error envelope's `code`. Callers branch on this, never on the message. */
export const ErrorCode = {
  BadUserInput: 'BAD_USER_INPUT',
  Unauthenticated: 'UNAUTHENTICATED',
  Forbidden: 'FORBIDDEN',
  NotFound: 'NOT_FOUND',
  Conflict: 'CONFLICT',
  Internal: 'INTERNAL',
  /** A downstream MCP server, a registry or npm answered with a failure or could not be reached. */
  UpstreamFailed: 'UPSTREAM_FAILED',
  /** A downstream server is backed off after crashing. */
  Unavailable: 'UNAVAILABLE',
  UpstreamTimeout: 'UPSTREAM_TIMEOUT',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60_000;
export const SECONDS_PER_MINUTE = 60;
export const SECONDS_PER_HOUR = 3600;
