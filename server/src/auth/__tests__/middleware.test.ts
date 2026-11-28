import { ErrorCode } from '@mcp-router/shared';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetTestDb } from '../../db/__tests__/test-db.ts';
import type { Database } from '../../db/client.ts';
import type { AuthHost } from '../auth-host.ts';
import { listKeys, revokeKey } from '../keys.ts';
import {
  createApiKeyMiddleware,
  createCallerMiddleware,
  createOriginMiddleware,
  isLoopbackOrigin,
} from '../middleware.ts';
import { createTestAuthHost, mintTestKey, signInTestOperator } from './test-auth.ts';

describe('the credential guards', () => {
  let database: Database;
  let authHost: AuthHost;
  let key: string;

  beforeAll(async () => {
    database = await createTestDb();
  });

  afterAll(() => database.close());

  beforeEach(async () => {
    await resetTestDb(database);
    authHost = await createTestAuthHost(database.db);
    key = await mintTestKey(database.db, authHost);
  });

  /** An app with a guarded /mcp and /admin/mcp, each answering 200 once through. */
  const appWith = () => {
    const app = express();
    app.use('/mcp', createApiKeyMiddleware(authHost), (_req, res) => res.json({ ok: true }));
    app.use('/admin/mcp', createCallerMiddleware(authHost), (_req, res) => res.json({ ok: true }));
    return app;
  };

  it('refuses /mcp with no key, with the envelope and a hint', async () => {
    const res = await request(appWith()).post('/mcp');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(ErrorCode.Unauthenticated);
    expect(res.body.error).toContain('x-api-key');
  });

  it('takes a key as Authorization: Bearer or as x-api-key', async () => {
    expect((await request(appWith()).post('/mcp').set('Authorization', `Bearer ${key}`)).status).toBe(200);
    expect((await request(appWith()).post('/mcp').set('x-api-key', key)).status).toBe(200);
  });

  it('refuses a wrong key, a non-bearer scheme, and a revoked key', async () => {
    expect((await request(appWith()).post('/mcp').set('Authorization', 'Bearer mcpr_wrong')).status).toBe(401);
    expect((await request(appWith()).post('/mcp').set('Authorization', `Basic ${key}`)).status).toBe(401);
    const [listed] = await listKeys(database.db);
    await revokeKey(database.db, listed?.id ?? '');
    expect((await request(appWith()).post('/mcp').set('x-api-key', key)).status).toBe(401);
  });

  it('answers two different keys in one request with 400', async () => {
    const res = await request(appWith()).post('/mcp').set('Authorization', `Bearer ${key}`).set('x-api-key', 'other');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ErrorCode.BadUserInput);
  });

  it('never opens /mcp to a session, but opens /admin/mcp to one', async () => {
    const { token } = await signInTestOperator(database.db, authHost);
    expect((await request(appWith()).post('/mcp').set('Authorization', `Bearer ${token}`)).status).toBe(401);
    expect((await request(appWith()).post('/admin/mcp').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    expect((await request(appWith()).post('/admin/mcp').set('x-api-key', key)).status).toBe(200);
    expect((await request(appWith()).post('/admin/mcp')).status).toBe(401);
  });

  it('opens /mcp without a key on a trusted network, and leaves /admin/mcp guarded', async () => {
    const app = express();
    app.use('/mcp', createApiKeyMiddleware(authHost, { trustedNetwork: true }), (_req, res) => res.json({ ok: true }));
    app.use('/admin/mcp', createCallerMiddleware(authHost), (_req, res) => res.json({ ok: true }));
    expect((await request(app).post('/mcp')).status).toBe(200);
    expect((await request(app).post('/mcp/echo')).status).toBe(200);
    expect((await request(app).post('/admin/mcp')).status).toBe(401);
  });
});

describe('isLoopbackOrigin', () => {
  it('recognizes loopback hosts on any port', () => {
    for (const origin of ['http://localhost', 'http://localhost:6274', 'http://127.0.0.1:3001', 'http://[::1]:80']) {
      expect(isLoopbackOrigin(origin)).toBe(true);
    }
  });

  it('rejects non-loopback and malformed origins', () => {
    for (const origin of ['http://evil.com', 'https://mcp.example.com', 'not-a-url', '']) {
      expect(isLoopbackOrigin(origin)).toBe(false);
    }
  });
});

describe('origin middleware', () => {
  function appWith(allowed: string[]) {
    const app = express();
    app.use(createOriginMiddleware(() => allowed));
    app.post('/mcp', (_req, res) => res.json({ ok: true }));
    return app;
  }

  it('allows requests with no Origin (native MCP clients, curl)', async () => {
    const res = await request(appWith([])).post('/mcp');
    expect(res.status).toBe(200);
  });

  it('allows loopback origins without configuration', async () => {
    const res = await request(appWith([])).post('/mcp').set('Origin', 'http://localhost:6274');
    expect(res.status).toBe(200);
  });

  it('rejects a foreign origin with 403 (DNS-rebinding guard)', async () => {
    const res = await request(appWith([])).post('/mcp').set('Origin', 'http://evil.com');
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('evil.com');
  });

  it('allows a configured foreign origin', async () => {
    const res = await request(appWith(['https://mcp.example.com']))
      .post('/mcp')
      .set('Origin', 'https://mcp.example.com');
    expect(res.status).toBe(200);
  });
});
