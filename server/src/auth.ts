import { createHash, timingSafeEqual } from 'node:crypto';
import { HttpStatus, type SettingsFile } from '@mcp-router/shared';
import type { RequestHandler } from 'express';
import { authDisabledByEnv, envToken } from './config/env.ts';

export interface AuthConfig {
  enabled: boolean;
  token: string | null;
}

/**
 * The auth actually in force: settings.json, as overridden by the environment.
 * `SECURE_LOCAL_NET` turns it off, and `MCP_ROUTER_TOKEN` replaces the stored token.
 */
export function effectiveAuth(
  settings: Pick<SettingsFile, 'authEnabled' | 'authToken'>,
  env?: NodeJS.ProcessEnv,
): AuthConfig {
  return {
    enabled: settings.authEnabled && !authDisabledByEnv(env),
    token: envToken(env) ?? settings.authToken,
  };
}

/** Constant-time comparison that does not leak token length (compares sha256 digests). */
export function tokensEqual(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a).digest();
  const digestB = createHash('sha256').update(b).digest();
  return timingSafeEqual(digestA, digestB);
}

/** True for loopback origins (localhost / 127.0.0.1 / ::1, any port), which a remote attacker cannot forge. */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  } catch {
    return false;
  }
}

/**
 * DNS-rebinding guard for /mcp: browsers attach an `Origin` header a page cannot
 * spoof, so a rebound request from a malicious site carries that site's origin.
 * Native MCP clients send no Origin at all. Allow no-Origin and loopback requests
 * plus any operator-configured origin; reject the rest with 403.
 */
export function createOriginMiddleware(getAllowedOrigins: () => string[]): RequestHandler {
  return (req, res, next) => {
    const header = req.headers.origin;
    const origin = Array.isArray(header) ? header[0] : header;
    if (!origin || isLoopbackOrigin(origin) || getAllowedOrigins().includes(origin)) {
      next();
      return;
    }
    res.status(HttpStatus.Forbidden).json({ error: `Origin "${origin}" is not allowed` });
  };
}

/**
 * Bearer-token middleware for /api and /mcp. Skipped entirely when auth is
 * disabled; otherwise rejects with a 401 JSON envelope.
 */
export function createAuthMiddleware(getAuth: () => AuthConfig): RequestHandler {
  return (req, res, next) => {
    const { enabled, token } = getAuth();
    if (enabled === false) {
      next();
      return;
    }
    if (!token) {
      res.status(HttpStatus.Unauthorized).json({ error: 'Auth is enabled but no token is configured' });
      return;
    }
    const header = req.headers.authorization;
    const provided = header?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!provided || !tokensEqual(provided, token)) {
      res.status(HttpStatus.Unauthorized).json({ error: 'Unauthorized' });
      return;
    }
    next();
  };
}
