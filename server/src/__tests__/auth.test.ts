import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { authDisabledByEnv, createAuthMiddleware, tokensEqual } from '../auth.ts';

function appWith(auth: { enabled: boolean; token: string | null }) {
  const app = express();
  app.use(createAuthMiddleware(() => auth));
  app.get('/api/status', (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe('auth middleware', () => {
  const token = 'secret-token';

  it('rejects requests without a token', async () => {
    const res = await request(appWith({ enabled: true, token })).get('/api/status');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('rejects requests with a wrong token', async () => {
    const res = await request(appWith({ enabled: true, token }))
      .get('/api/status')
      .set('Authorization', 'Bearer wrong');
    expect(res.status).toBe(401);
  });

  it('rejects non-bearer authorization schemes', async () => {
    const res = await request(appWith({ enabled: true, token }))
      .get('/api/status')
      .set('Authorization', `Basic ${token}`);
    expect(res.status).toBe(401);
  });

  it('accepts the correct bearer token', async () => {
    const res = await request(appWith({ enabled: true, token }))
      .get('/api/status')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('skips auth entirely when disabled', async () => {
    const res = await request(appWith({ enabled: false, token: null })).get('/api/status');
    expect(res.status).toBe(200);
  });

  it('rejects everything when enabled without a configured token', async () => {
    const res = await request(appWith({ enabled: true, token: null }))
      .get('/api/status')
      .set('Authorization', 'Bearer anything');
    expect(res.status).toBe(401);
  });

  it('compares tokens without throwing on length mismatch', () => {
    expect(tokensEqual('short', 'a-much-longer-token')).toBe(false);
    expect(tokensEqual('same', 'same')).toBe(true);
  });
});

describe('authDisabledByEnv', () => {
  it('is false when SECURE_LOCAL_NET is unset', () => {
    expect(authDisabledByEnv({})).toBe(false);
  });

  it('treats common truthy values as disabling auth', () => {
    for (const value of ['true', 'TRUE', '1', 'yes', 'on', ' true ']) {
      expect(authDisabledByEnv({ SECURE_LOCAL_NET: value })).toBe(true);
    }
  });

  it('leaves auth enabled for falsey or unrelated values', () => {
    for (const value of ['false', '0', 'no', 'off', '']) {
      expect(authDisabledByEnv({ SECURE_LOCAL_NET: value })).toBe(false);
    }
  });
});
