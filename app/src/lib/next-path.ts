/** A path on this origin: one leading slash, not two, so `//evil.example` is not one. */
const SAME_ORIGIN_PATH = /^\/(?!\/)/;

/**
 * Reads the `next` of the sign-in page's URL.
 *
 * @param value - The search parameter as the router parsed it.
 * @returns The path, or undefined for anything that is not a path on this origin, so a crafted link cannot send a
 * fresh session elsewhere.
 */
export function safeNextPath(value: unknown): string | undefined {
  return typeof value === 'string' && SAME_ORIGIN_PATH.test(value) ? value : undefined;
}
