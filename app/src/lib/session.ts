import { useSyncExternalStore } from 'react';

// The session the UI signed in with: a bearer token in `localStorage`, never a cookie, and a small store so the app
// frame hears when it is kept or dropped. The API client drops it when the server answers UNAUTHENTICATED, and the
// root route sends the browser to sign-in once there is none.

/** The `localStorage` key the session token is kept under. */
export const SESSION_STORAGE_KEY = 'mcp-router.session';

/** A subscriber to the session. */
type Listener = () => void;

const listeners = new Set<Listener>();

/** Tells every subscriber the session changed. */
function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Reads the session token the UI signed in with.
 *
 * @returns The token, or null when signed out or when storage is unavailable.
 */
export function sessionToken(): string | null {
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Keeps a new session token.
 *
 * @param token - The token a sign-in answered with.
 */
export function keepSession(token: string): void {
  window.localStorage.setItem(SESSION_STORAGE_KEY, token);
  emit();
}

/** Forgets the session token, signing the UI out. */
export function forgetSession(): void {
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Nothing kept, so nothing to forget.
  }
  emit();
}

/**
 * Subscribes to changes of the session.
 *
 * @param listener - Called with nothing on every change.
 * @returns The unsubscribe function.
 */
function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Subscribes a component to the session.
 *
 * @returns Whether the UI holds a session; false once a sign-out or a refused request has dropped it.
 */
export function useHasSession(): boolean {
  return useSyncExternalStore(subscribe, () => sessionToken() !== null);
}
