import { type ApiError, ErrorCode, HttpStatus } from '@mcp-router/shared';
import { buildSchema, graphql } from 'graphql';
import { fn } from 'storybook/test';
import schemaSdl from '@/__generated__/schema.graphql?raw';
import { forgetSession, keepSession } from '@/lib/session';

/** The schema /graphql serves, as codegen printed it. Every mocked answer is run through it. */
const schema = buildSchema(schemaSdl);

/** Where the UI sends its GraphQL operations. */
const GRAPHQL_PATH = '/graphql';

/** The session every story starts signed in with. A story about being signed out forgets it in its `beforeEach`. */
export const STORY_SESSION = 'story-session';

/** What a mocked answer was asked: the operation's variables, as `body`, and the URL. */
interface MockRequest {
  body: unknown;
  url: URL;
}

/** A failed answer for a mocked operation. Build one with `apiError`. */
class MockApiError {
  readonly status: HttpStatus;
  readonly body: ApiError;

  /**
   * Pairs a status with the error to answer with.
   *
   * @param status - A 401 is /graphql's door refusing the token; any other status answers 200 with the error.
   * @param body - The error envelope: its `error` and `code` become a GraphQL error's message and `extensions.code`.
   */
  constructor(status: HttpStatus, body: ApiError) {
    this.status = status;
    this.body = body;
  }
}

/** An answer that never arrives, for a story about the loading state. */
const PENDING = Symbol('pending');

/**
 * The answers of a story's server. An operation is keyed by its name (`Servers`, `UpdateServer`) and answered with its
 * `data`. A value may also be `apiError(...)` for a failure, `pending()` for an answer that never settles, or a
 * function of the request (the operation's variables, as `body`) returning any of those.
 */
export type ApiRoutes = Record<string, unknown>;

/**
 * Every operation a story's components sent, as `(name, variables)`. Assert on it in `play`:
 * `expect(apiRequest).toHaveBeenCalledWith('UpdateServer', { name: 'docs', input: { enabled: false } })`.
 */
export const apiRequest = fn<(key: string, body: unknown) => void>();

/**
 * Builds a failed answer for a mocked operation.
 *
 * @param status - The HTTP status of the failure. The operation answers 200 with the error in `errors`, except for a
 * 401, which /graphql's door sends before any operation runs.
 * @param code - The error code.
 * @param error - The message.
 * @param [detail] - The longer explanation; left off when empty.
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

/** What the UI posts to /graphql. */
interface GraphQLRequestBody {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
}

/**
 * Answers one GraphQL operation from a story's answers.
 *
 * @param body - What the UI posted.
 * @param answer - The story's answer: the operation's `data`, or a failure.
 * @returns The response.
 *
 * @remarks
 * The data is run through the real schema as the root value, so an answer missing a non-null field, holding a value
 * of the wrong type, or an operation asking for a field the schema lacks, comes back as an error and is logged.
 */
async function answerOperation(body: GraphQLRequestBody, answer: unknown): Promise<Response> {
  if (answer instanceof MockApiError) {
    if (answer.status === HttpStatus.Unauthorized) {
      return jsonResponse(answer.status, answer.body);
    }
    const { error: message, code, detail } = answer.body;
    return jsonResponse(HttpStatus.Ok, { errors: [{ message, extensions: { code, ...(detail ? { detail } : {}) } }] });
  }
  const result = await graphql({
    schema,
    source: body.query,
    rootValue: answer,
    variableValues: body.variables,
    operationName: body.operationName,
  });
  if (result.errors !== undefined) {
    console.error(`[mock-api] ${body.operationName} does not match the schema:`, result.errors);
  }
  return jsonResponse(HttpStatus.Ok, result);
}

/**
 * Replaces `fetch` with a story's server for the length of one story.
 *
 * @param [routes] - The story's `parameters.api`.
 * @returns The cleanup that puts the real `fetch` back and forgets the session.
 *
 * @remarks
 * An operation with no answer fails and is logged, so a story that forgot one fails where it is read. A request to any
 * other path than /graphql fails too: the UI has no other API. Also clears the calls recorded on `apiRequest`, and
 * signs the story in with {@link STORY_SESSION}, so a page renders inside the app frame rather than at sign-in.
 */
export function installApiMock(routes: ApiRoutes = {}): () => void {
  const realFetch = window.fetch;
  apiRequest.mockClear();
  keepSession(STORY_SESSION);

  window.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const text = await request.text();
    if (url.pathname !== GRAPHQL_PATH) {
      console.error(`[mock-api] ${request.method} ${url.pathname} is not an API the UI has`);
      return jsonResponse(HttpStatus.NotFound, { error: `No such path ${url.pathname}`, code: ErrorCode.NotFound });
    }
    const operation: GraphQLRequestBody = text ? JSON.parse(text) : { query: '' };
    const key = operation.operationName ?? '';
    const body = operation.variables;
    apiRequest(key, body);

    const isMocked = key in routes;
    if (isMocked === false) {
      console.error(`[mock-api] no answer for ${key}`);
      const message = `No mocked answer for ${key}`;
      return jsonResponse(HttpStatus.Ok, { errors: [{ message, extensions: { code: ErrorCode.NotFound } }] });
    }
    const route = routes[key];
    const mockRequest: MockRequest = { body, url };
    const answer: unknown = typeof route === 'function' ? await route(mockRequest) : route;
    if (answer === PENDING) {
      return new Promise<Response>(() => {});
    }
    return answerOperation(operation, answer);
  };

  return () => {
    window.fetch = realFetch;
    // Every story starts from the session it is given, not the one the story before it left.
    forgetSession();
  };
}
