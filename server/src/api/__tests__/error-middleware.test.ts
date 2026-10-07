import { ErrorCode } from '@mcp-router/shared';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { conflict } from '../../errors.ts';
import { errorMiddleware } from '../error-middleware.ts';

function appThrowing(err: unknown) {
  const app = express();
  app.use(express.json({ limit: '1kb' }));
  app.post('/', () => {
    throw err;
  });
  app.use(errorMiddleware);
  return app;
}

describe('errorMiddleware', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hides the message of an unexpected error and logs it', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cause = new Error("ENOENT: no such file or directory, open '/data/config/settings.json'");

    const res = await request(appThrowing(cause)).post('/').send({});

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error', code: ErrorCode.Internal });
    expect(logged).toHaveBeenCalledWith('[api] unhandled error:', cause);
  });

  it('sends the status, message, code and detail of an HttpError', async () => {
    const res = await request(appThrowing(conflict('Server "a" already exists', 'pick another name')))
      .post('/')
      .send({});

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: 'Server "a" already exists',
      code: ErrorCode.Conflict,
      detail: 'pick another name',
    });
  });

  it('answers a malformed JSON body with a 400', async () => {
    const res = await request(appThrowing(new Error('unreachable')))
      .post('/')
      .set('content-type', 'application/json')
      .send('{"a":');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/JSON/);
    expect(res.body.code).toBe(ErrorCode.BadUserInput);
  });

  it('answers a body over the size limit with a 413', async () => {
    const res = await request(appThrowing(new Error('unreachable')))
      .post('/')
      .send({ padding: 'x'.repeat(2_000) });

    expect(res.status).toBe(413);
  });
});
