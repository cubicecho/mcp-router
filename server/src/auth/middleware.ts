import { createHash, timingSafeEqual } from 'node:crypto';
import type { SettingsFile } from '@mcp-router/shared';
import type { RequestHandler } from 'express';
import { authDisabledByEnv, envToken } from '../config/env.ts';
import { forbidden, sendError, unauthenticated } from '../core/errors.ts';

/** The auth in force for a request. */
export interface AuthConfig {
  /** False lets every request through. */
  enabled: boolean;
  /** The bearer token to match; null means none is configured, so every request is refused while enabled. */
  token: string | null;
}

/**
 * Resolves the auth actually in force: settings.json, as overridden by the environment.
 *
 * @param settings - The stored auth settings.
 * @param [env] - Read for `SECURE_LOCAL_NET`, which turns auth off, and `MCP_ROUTER_TOKEN`, which replaces the token.
 * @returns Whether auth is on, and the token to match.
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

/**
 * Compares two tokens in constant time, without leaking their length (it compares sha256 digests).
 *
 * @param a - One token.
 * @param b - The other token.
 * @returns True when the tokens are identical.
 */
export function tokensEqual(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a).digest();
  const digestB = createHash('sha256').update(b).digest();
  return timingSafeEqual(digestA, digestB);
}

/**
 * Tells whether an origin is a loopback one, which a remote attacker cannot forge.
 *
 * @param origin - An `Origin` header value.
 * @returns True for localhost, 127.0.0.1 or ::1 on any port; false for anything else, an unparsable value included.
 */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  } catch {
    return false;
  }
}

/**
 * Builds the DNS-rebinding guard for /mcp, which rejects a disallowed `Origin` with 403.
 *
 * @param getAllowedOrigins - The operator-configured origins, read on every request.
 * @returns Middleware that passes requests with no Origin, a loopback one or an allowed one.
 *
 * @remarks
 * Browsers attach an `Origin` header a page cannot spoof, so a rebound request from a malicious site carries that
 * site's origin. Native MCP clients send no Origin at all.
 */
export function createOriginMiddleware(getAllowedOrigins: () => string[]): RequestHandler {
  return (req, res, next) => {
    const header = req.headers.origin;
    const origin = Array.isArray(header) ? header[0] : header;
    if (!origin || isLoopbackOrigin(origin) || getAllowedOrigins().includes(origin)) {
      next();
      return;
    }
    sendError(res, forbidden(`Origin "${origin}" is not allowed`));
  };
}

/**
 * Builds the bearer-token middleware for /api and /mcp.
 *
 * @param getAuth - The auth in force, read on every request.
 * @returns Middleware that passes everything when auth is disabled, and otherwise answers a missing or wrong token
 * with a 401 JSON envelope.
 */
export function createAuthMiddleware(getAuth: () => AuthConfig): RequestHandler {
  return (req, res, next) => {
    const { enabled, token } = getAuth();
    if (enabled === false) {
      next();
      return;
    }
    if (!token) {
      sendError(res, unauthenticated('Auth is enabled but no token is configured'));
      return;
    }
    const header = req.headers.authorization;
    const provided = header?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!provided || !tokensEqual(provided, token)) {
      sendError(res, unauthenticated('Unauthorized'));
      return;
    }
    next();
  };
}
