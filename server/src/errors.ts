/** An error carrying an HTTP status code; rendered by the API error middleware as { error, detail? }. */
export class HttpError extends Error {
  readonly status: number;
  readonly detail?: string;

  constructor(status: number, message: string, detail?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HttpError';
    this.status = status;
    this.detail = detail;
  }
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
