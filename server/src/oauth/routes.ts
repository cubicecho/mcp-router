import { HttpStatus, type OAuthResultMessage } from '@mcp-router/shared';
import { type Request, type Response, Router } from 'express';
import type { ConfigStore } from '../config/store.ts';
import { OAUTH_DEFAULTS } from '../core/defaults.ts';
import { errorDetailMessage, HttpError } from '../core/errors.ts';
import { callbackUrl, clientMetadataUrl, routerClientMetadata } from './provider.ts';
import type { OAuthService } from './service.ts';

/** The characters HTML gives meaning to, with their escapes. */
const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * Escapes text for HTML.
 *
 * @param text - Any text.
 * @returns It, safe between tags and inside a quoted attribute.
 */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

/**
 * The page the login sends the browser back to: says how it went, tells the UI, and closes.
 *
 * @param message - What the opener is told.
 * @param uiOrigin - The opener's origin; the message goes to it alone. Without one, nothing is posted.
 * @returns The HTML.
 */
function resultPage(message: OAuthResultMessage, uiOrigin: string | undefined): string {
  const heading = message.ok ? 'Signed in' : 'Sign-in failed';
  const body = message.ok
    ? `MCP Router is signed in to ${message.server}. You can close this window.`
    : (message.error ?? 'The sign-in did not finish.');
  // `<` escaped so nothing in the JSON can close the script element.
  const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
  const script = uiOrigin
    ? `<script>
  if (window.opener) {
    window.opener.postMessage(${json(message)}, ${json(uiOrigin)});
    ${message.ok ? 'window.close();' : ''}
  }
</script>`
    : '';
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${heading} · MCP Router</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1f2328;background:#fff}@media (prefers-color-scheme:dark){body{color:#e6edf3;background:#0d1117}}</style></head>
<body><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(body)}</p>${script}</body>
</html>`;
}

/**
 * The router's address as the server's login reaches it.
 *
 * @param store - For `publicUrl`.
 * @param req - Read for its protocol and host when `publicUrl` is unset.
 * @returns The base URL.
 */
function routerBase(store: ConfigStore, req: Request): string {
  return store.getSettings().publicUrl ?? `${req.protocol}://${req.get('host')}`;
}

/**
 * Builds the OAuth endpoints a server's login calls without the router's bearer token: the client metadata document
 * and the redirect back. Mounted at the root, before the auth middleware.
 *
 * @param deps.store - For `publicUrl`.
 * @param deps.oauth - Finishes the sign-ins.
 * @returns The router.
 *
 * @remarks
 * The callback needs no bearer token because the `state` it carries is the credential: unguessable, matched to a
 * flow this process started from an authenticated request, and good once.
 */
export function createOAuthRoutes({ store, oauth }: { store: ConfigStore; oauth: OAuthService }): Router {
  const router = Router();

  // The router's client id, for a login that takes a URL as one (Client ID Metadata Documents; Home Assistant).
  router.get(OAUTH_DEFAULTS.clientMetadataPath, (req, res) => {
    const base = routerBase(store, req);
    res.json({
      client_id: clientMetadataUrl(base),
      client_uri: new URL('/', base).toString(),
      ...routerClientMetadata(callbackUrl(base)),
    });
  });

  router.get(OAUTH_DEFAULTS.callbackPath, async (req: Request, res: Response) => {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const loginError = typeof req.query.error === 'string' ? req.query.error : undefined;
    res.type('html').set('Cache-Control', 'no-store');

    if (loginError || !code) {
      const flow = oauth.abandon(state);
      const description = typeof req.query.error_description === 'string' ? req.query.error_description : undefined;
      const error = loginError
        ? `The login refused: ${description ?? loginError}`
        : 'The login sent no authorization code back.';
      res
        .status(HttpStatus.BadRequest)
        .send(
          resultPage({ type: 'mcp-router-oauth', server: flow?.serverName ?? '', ok: false, error }, flow?.uiOrigin),
        );
      return;
    }

    try {
      const { serverName, uiOrigin } = await oauth.finish(state, code);
      res.send(resultPage({ type: 'mcp-router-oauth', server: serverName, ok: true }, uiOrigin));
    } catch (cause) {
      const status = cause instanceof HttpError ? cause.status : HttpStatus.InternalServerError;
      console.warn(`[oauth] callback failed: ${errorDetailMessage(cause)}`);
      res
        .status(status)
        .send(
          resultPage({ type: 'mcp-router-oauth', server: '', ok: false, error: errorDetailMessage(cause) }, undefined),
        );
    }
  });

  return router;
}
