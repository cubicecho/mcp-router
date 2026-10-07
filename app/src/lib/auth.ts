import { useSyncExternalStore } from 'react';

/**
 * Bearer-token storage plus a tiny external store for the "needs auth" flag.
 * The fetch wrapper flips the flag on any 401; the root layout watches it and
 * swaps in the token-entry screen.
 */

/** The `localStorage` key the bearer token is kept under. */
export const TOKEN_STORAGE_KEY = 'mcp-router-token';

/** A subscriber to the needs-auth flag. */
type Listener = () => void;

let needsAuth = false;
const listeners = new Set<Listener>();

/** Tells every subscriber the needs-auth flag changed. */
function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Reads the stored bearer token.
 *
 * @returns The token, or null when none is stored.
 */
export function getToken(): string | null {
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

/**
 * Stores the bearer token and lowers the needs-auth flag.
 *
 * @param token - The token to send on every API request.
 */
export function setToken(token: string): void {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  if (needsAuth) {
    needsAuth = false;
    emit();
  }
}

/** Forgets the stored bearer token; the needs-auth flag is left as it is. */
export function clearToken(): void {
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
}

/** Raises the needs-auth flag; the API client calls it whenever a request comes back 401. */
export function requireAuth(): void {
  if (!needsAuth) {
    needsAuth = true;
    emit();
  }
}

/**
 * Reads the needs-auth flag.
 *
 * @returns true once a request has come back 401 and no token has been set since.
 */
export function getNeedsAuth(): boolean {
  return needsAuth;
}

/**
 * Subscribes to changes of the needs-auth flag.
 *
 * @param listener - Called with nothing on every change.
 * @returns The unsubscribe function.
 */
function subscribeNeedsAuth(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Subscribes a component to the needs-auth flag.
 *
 * @returns true while the token-entry screen should be shown.
 */
export function useNeedsAuth(): boolean {
  return useSyncExternalStore(subscribeNeedsAuth, getNeedsAuth);
}
