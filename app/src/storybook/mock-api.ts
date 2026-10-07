import { type ApiError, ErrorCode, HttpStatus } from '@mcp-router/shared';
import { fn } from 'storybook/test';
import { clearToken, setToken } from '@/lib/auth';

/** What a mocked route was asked: the parsed JSON body and the request URL. */
interface MockRequest {
  body: unknown;
  url: URL;
}

/** A failed answer for a mocked route. Build one with `apiError`. */
class MockApiError {
  readonly status: HttpStatus;
  readonly body: ApiError;

  /**
   * Pairs a status with the envelope to answer with.
   *
   * @param status - The HTTP status to answer with.
   * @param body - The error envelope sent as the JSON body.
   */
  constructor(status: HttpStatus, body: ApiError) {
    this.status = status;
    this.body = body;
  }
}

/** An answer that never arrives, for a story about the loading state. */
const PENDING = Symbol('pending');

/**
 * The answers of a story's server, keyed `"<METHOD> <path>"` (the path without its query).
 * A value is the JSON body, `null` for a 204, `apiError(...)` for a failure, `pending()` for a
 * request that never settles, or a function of the request returning any of those.
 */
export type ApiRoutes = Record<string, unknown>;

/**
 * Every request a story's components sent, as `(key, body)`. Assert on it in `play`:
 * `expect(apiRequest).toHaveBeenCalledWith('POST /api/servers', { ... })`.
 */
export const apiRequest = fn<(key: string, body: unknown) => void>();

/**
 * Builds a failed answer for a mocked route.
 *
 * @param status - The HTTP status to answer with.
 * @param code - The error code of the envelope.
 * @param error - The message of the envelope.
 * @param [detail] - The detail of the envelope; left off when empty.
 * @returns The value to put in a story's `parameters.api`.
 */
export function apiError(status: HttpStatus, code: ErrorCode, error: string, detail?: string): MockApiError {
  return new MockApiError(status, { error, code, ...(detail ? { detail } : {}) });
}

/**
 * Builds an answer that never arrives, for a story about the loading state.
 *
 * @returns The value to put in a story's `parameters.api`.
 */
export function pending(): typeof PENDING {
  return PENDING;
}

/**
 * Builds a JSON response.
 *
 * @param status - The HTTP status.
 * @param body - Serialised as the JSON body.
 * @returns The response, with a JSON Content-Type.
 */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Replaces `fetch` with a story's server for the length of one story.
 *
 * @param [routes] - The story's `parameters.api`.
 * @returns The cleanup that puts the real `fetch` back and forgets any auth state.
 *
 * @remarks
 * A request with no route is answered 404 and logged, so a story that forgot one fails where it is read. Also clears
 * the calls recorded on `apiRequest`.
 */
export function installApiMock(routes: ApiRoutes = {}): () => void {
  const realFetch = window.fetch;
  apiRequest.mockClear();

  window.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const key = `${request.method} ${url.pathname}`;
    const text = await request.text();
    const body: unknown = text ? JSON.parse(text) : undefined;
    apiRequest(key, body);

    const isMocked = key in routes;
    if (isMocked === false) {
      console.error(`[mock-api] no route for ${key}`);
      return jsonResponse(HttpStatus.NotFound, { error: `No mocked route for ${key}`, code: ErrorCode.NotFound });
    }
    const route = routes[key];
    const mockRequest: MockRequest = { body, url };
    const answer: unknown = typeof route === 'function' ? await route(mockRequest) : route;
    if (answer === PENDING) {
      return new Promise<Response>(() => {});
    }
    if (answer instanceof MockApiError) {
      return jsonResponse(answer.status, answer.body);
    }
    if (answer === null) {
      return new Response(null, { status: HttpStatus.NoContent });
    }
    return jsonResponse(HttpStatus.Ok, answer);
  };

  return () => {
    window.fetch = realFetch;
    // A 401 in one story must not leave the next one behind the token screen.
    setToken('story');
    clearToken();
  };
}
